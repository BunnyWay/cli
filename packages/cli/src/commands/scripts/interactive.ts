import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import type { OutputFormat } from "../../core/types.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { fetchScript, fetchScripts } from "./api.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";

type ComputeClient = ReturnType<typeof createComputeClient>;
type EdgeScript = components["schemas"]["EdgeScriptModel"];

interface ResolveResult {
  script: EdgeScript;
  /** True only when chosen via the interactive picker, so linking is worth offering. */
  picked: boolean;
}

/**
 * Resolve an Edge Script from an explicit ID, the linked manifest, or an
 * interactive picker. The caller decides whether to offer linking afterwards
 * (see `maybeLinkScript`) so it can run once the command's own output is shown.
 *
 * In non-interactive output modes (`--output json`) the picker is skipped and
 * a UserError points the caller at `bunny scripts link`.
 */
export async function resolveScriptInteractive(
  client: ComputeClient,
  id: number | undefined,
  opts: { output: OutputFormat },
): Promise<ResolveResult> {
  const linkedId = id ?? loadManifest(SCRIPT_MANIFEST).id;
  if (linkedId) {
    const spin = spinner("Fetching Edge Script...");
    spin.start();
    try {
      return { script: await fetchScript(client, linkedId), picked: false };
    } finally {
      spin.stop();
    }
  }

  if (opts.output === "json") {
    throw new UserError(
      "No script ID provided and no linked script found.",
      "Run `bunny scripts link` or pass an ID explicitly.",
    );
  }

  const spin = spinner("Fetching Edge Scripts...");
  spin.start();
  let scripts: EdgeScript[];
  try {
    scripts = await fetchScripts(client);
  } finally {
    spin.stop();
  }

  if (scripts.length === 0) {
    throw new UserError(
      "No Edge Scripts found in your account.",
      "Create one with `bunny scripts init`.",
    );
  }

  const { selected } = await prompts({
    type: "select",
    name: "selected",
    message: "Select a script:",
    choices: scripts.map((s) => ({ title: `${s.Name} (${s.Id})`, value: s })),
  });
  if (!selected) throw new UserError("A script is required.");

  return { script: selected, picked: true };
}

/** Offer to link the directory to a picked script: `link` forces the choice, otherwise prompt. */
export async function maybeLinkScript(
  script: EdgeScript,
  link: boolean | undefined,
): Promise<void> {
  const shouldLink =
    link !== undefined
      ? link
      : await confirm(`Link this directory to ${script.Name}?`);
  if (!shouldLink) return;

  saveManifest(SCRIPT_MANIFEST, {
    id: script.Id,
    name: script.Name ?? undefined,
    scriptType: script.ScriptType,
  });
  logger.success(`Linked to ${script.Name} (${script.Id}).`);
}
