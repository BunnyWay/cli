import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchEnvEntries } from "../api.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";

const COMMAND = "list [id]";
const ALIASES = ["ls"] as const;
const DESCRIPTION =
  "List environment variables and secrets for an Edge Script.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";

interface ListArgs {
  [ARG_ID]?: number;
}

/**
 * List all environment variables and secrets for an Edge Script.
 *
 * Fetches both plain variables and encrypted secrets in parallel, then
 * merges them into a single table sorted by name.
 *
 * @example
 * ```bash
 * # List for linked script
 * bunny scripts env list
 *
 * # List by script ID
 * bunny scripts env list 12345
 *
 * # Short alias
 * bunny scripts env ls
 *
 * # JSON output
 * bunny scripts env list --output json
 * ```
 */
export const scriptsEnvListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts env list", "List for linked script"],
    ["$0 scripts env list 12345", "List by script ID"],
    ["$0 scripts env list --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_ID, {
      type: "number",
      describe: ARG_ID_DESCRIPTION,
    }),

  handler: async ({ [ARG_ID]: rawId, profile, output, verbose, apiKey }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching environment variables...");
    spin.start();

    const entries = await fetchEnvEntries(client, id);

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      logger.info("No environment variables or secrets found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Value", "Secret"],
        entries.map((e) => [
          String(e.id),
          e.name,
          e.value,
          e.secret ? "Yes" : "No",
        ]),
        output,
      ),
    );
  },
});
