import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import prompts from "prompts";
import type { Argv } from "yargs";
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
async function resolveScriptInteractive(
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

  // The list endpoint returns a trimmed model; re-fetch by ID so callers get
  // the same full shape as an explicit-ID lookup (variables, hostnames, etc.).
  return {
    script: await fetchScript(client, selected.Id as number),
    picked: true,
  };
}

/** Offer to link the directory to a picked script: `link` forces the choice, otherwise prompt. */
async function maybeLinkScript(
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

const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_LINK_DESCRIPTION =
  "Link the directory to the picked script (use --no-link to skip the prompt)";

/** Args contributed by {@link scriptSelectorBuilder}. Extend a command's args with this. */
export interface ScriptSelectorArgs {
  id?: number;
  link?: boolean;
}

/**
 * Shared yargs fragment for commands that act on a single Edge Script: the
 * optional `[id]` positional and the `--link` flag. Chainable, so a command
 * can add its own options afterwards.
 *
 * Pair it with the `[id]` positional in the command string, e.g.
 * `command: "show [id]"`.
 */
export function scriptSelectorBuilder<T>(
  yargs: Argv<T>,
): Argv<T & ScriptSelectorArgs> {
  return yargs
    .positional("id", { type: "number", describe: ARG_ID_DESCRIPTION })
    .option("link", {
      type: "boolean",
      describe: ARG_LINK_DESCRIPTION,
    }) as Argv<T & ScriptSelectorArgs>;
}

/**
 * Like {@link scriptSelectorBuilder}, but exposes the script ID as an `--id`
 * option instead of a positional — for commands that already use positionals
 * for their own arguments (e.g. `env set [name] [value]`).
 */
export function scriptIdOptionBuilder<T>(
  yargs: Argv<T>,
): Argv<T & ScriptSelectorArgs> {
  return yargs
    .option("id", { type: "number", describe: ARG_ID_DESCRIPTION })
    .option("link", {
      type: "boolean",
      describe: ARG_LINK_DESCRIPTION,
    }) as Argv<T & ScriptSelectorArgs>;
}

interface SelectedScript {
  script: EdgeScript;
  id: number;
  /**
   * Offer to link the directory to the script — but only when it was chosen
   * via the interactive picker. A no-op otherwise, so commands can always call
   * it at the end of the handler without branching on how the script was found.
   */
  offerLink: () => Promise<void>;
}

/**
 * Resolve the Edge Script a command should act on — from an explicit ID, the
 * linked manifest, or an interactive picker — and return a deferred `offerLink`
 * to run once the command's own output is shown.
 *
 * This is the entry point for `[id]`-style script commands; pair it with
 * {@link scriptSelectorBuilder} and {@link ScriptSelectorArgs}.
 */
export async function selectScript(
  client: ComputeClient,
  args: ScriptSelectorArgs & { output: OutputFormat },
): Promise<SelectedScript> {
  const { script, picked } = await resolveScriptInteractive(client, args.id, {
    output: args.output,
  });

  return {
    script,
    id: script.Id as number,
    offerLink: async () => {
      if (!picked) return;
      logger.log();
      await maybeLinkScript(script, args.link);
    },
  };
}
