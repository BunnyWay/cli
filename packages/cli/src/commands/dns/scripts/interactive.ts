import prompts from "prompts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { type ComputeClient, fetchDnsScripts } from "./api.ts";
import { DNS_SCRIPT_MANIFEST, type DnsScriptManifest } from "./constants.ts";

/**
 * Resolve a DNS script ID from an explicit value, the linked manifest, or a
 * picker over the account's DNS scripts.
 *
 * Resolution order: explicit `id` -> `.bunny/dns-script.json` -> prompt.
 * Throws when none is available (non-interactive with nothing linked).
 */
export async function resolveDnsScriptId(
  client: ComputeClient,
  id: number | undefined,
  action: string,
  interactive: boolean,
): Promise<number> {
  if (id) return id;

  const manifest = loadManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST);
  if (manifest.id) {
    logger.dim(`Using linked DNS script ${manifest.name ?? manifest.id}.`);
    return manifest.id;
  }

  if (!interactive) {
    throw new UserError(
      "No DNS script ID provided and none linked.",
      "Pass an ID, or run from a directory created by `bunny dns scripts init`.",
    );
  }

  const spin = spinner("Fetching DNS scripts...");
  spin.start();
  let scripts: Awaited<ReturnType<typeof fetchDnsScripts>>;
  try {
    scripts = await fetchDnsScripts(client);
  } finally {
    spin.stop();
  }

  if (scripts.length === 0) {
    throw new UserError(
      "No DNS scripts found.",
      "Create one with `bunny dns scripts create`.",
    );
  }

  const { value } = await prompts({
    type: "select",
    name: "value",
    message: `DNS script to ${action}:`,
    choices: scripts.map((s) => ({
      title: `${s.Name ?? "(unnamed)"} (${s.Id})`,
      value: s.Id,
    })),
  });
  if (value === undefined) throw new UserError("A DNS script is required.");
  return value;
}
