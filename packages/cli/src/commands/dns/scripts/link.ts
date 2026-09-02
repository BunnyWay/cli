import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import { prompts, spinner } from "@/core/ui.ts";
import { fetchDnsScript, fetchDnsScripts } from "./api.ts";
import {
  DEFAULT_ENTRY,
  DNS_SCRIPT_MANIFEST,
  type DnsScriptManifest,
  SCRIPT_TYPE_DNS,
} from "./constants.ts";

const COMMAND = "link [id]";
const DESCRIPTION = "Link the current directory to a Scriptable DNS script.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "DNS script ID (skips the interactive prompt)";

interface LinkArgs {
  [ARG_ID]?: number;
}

/**
 * Link the current directory to an existing Scriptable DNS script.
 *
 * Writes the script ID into `.bunny/dns-script.json` so `deploy` and
 * `attach` resolve it without an explicit ID. Use this when a directory
 * wasn't created by `init`/`create` (e.g. a cloned repo). A pre-existing
 * manifest's entry file is preserved.
 *
 * @example
 * ```bash
 * # Interactive selection
 * bunny dns scripts link
 *
 * # Direct link by ID
 * bunny dns scripts link 12345
 * ```
 */
export const dnsScriptsLinkCommand = defineCommand<LinkArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts link", "Interactive selection"],
    ["$0 dns scripts link 12345", "Direct link by ID"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_ID, {
      type: "number",
      describe: ARG_ID_DESCRIPTION,
    }),

  handler: async ({ [ARG_ID]: id, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));
    const existing = loadManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST);

    let selected: Awaited<ReturnType<typeof fetchDnsScript>>;
    if (id != null) {
      const spin = spinner("Fetching DNS script...");
      spin.start();
      try {
        selected = await fetchDnsScript(client, id);
      } finally {
        spin.stop();
      }
    } else {
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
        message: "DNS script to link:",
        choices: scripts.map((s) => ({
          title: `${s.Name ?? "(unnamed)"} (${s.Id})`,
          value: s,
        })),
      });
      if (!value) throw new UserError("Link cancelled.");
      selected = value;
    }

    saveManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST, {
      ...existing,
      id: selected.Id,
      name: selected.Name ?? undefined,
      scriptType: SCRIPT_TYPE_DNS,
      entry: existing.entry ?? DEFAULT_ENTRY,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: selected.Id, name: selected.Name }));
      return;
    }

    logger.success(`Linked to ${selected.Name} (${selected.Id}).`);
  },
});
