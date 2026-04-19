import { createComputeClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { SCRIPT_TYPE_LABELS } from "./constants.ts";

const COMMAND = "list";
const DESCRIPTION = "List all Edge Scripts.";

/**
 * List all Edge Scripts in the account.
 *
 * Fetches standalone and middleware scripts (excludes DNS scripts) and
 * displays them in a table with linked pull zone information.
 *
 * @example
 * ```bash
 * bunny scripts list
 *
 * # Short alias
 * bunny scripts ls
 *
 * # JSON output
 * bunny scripts list --output json
 * ```
 */
export const scriptsListCommand = defineCommand({
  command: COMMAND,
  aliases: ["ls"],
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts list", "List all Edge Scripts"],
    ["$0 scripts list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching Edge Scripts...");
    spin.start();

    const { data } = await client.GET("/compute/script", {
      params: {
        query: {
          includeLinkedPullzones: true,
          type: [1, 2],
        },
      },
    });

    spin.stop();

    const scripts = (data?.Items ?? []).sort((a, b) =>
      (a.Name ?? "").localeCompare(b.Name ?? ""),
    );

    if (output === "json") {
      logger.log(JSON.stringify(scripts, null, 2));
      return;
    }

    if (scripts.length === 0) {
      logger.info("No Edge Scripts found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Type", "Pull Zone"],
        scripts.map((script) => [
          String(script.Id ?? ""),
          script.Name ?? "",
          SCRIPT_TYPE_LABELS[script.ScriptType ?? -1] ?? "Unknown",
          (script.LinkedPullZones ?? [])
            .map((pz) => `${pz.DefaultHostname} (${pz.Id})`)
            .join(", "),
        ]),
        output,
      ),
    );
  },
});
