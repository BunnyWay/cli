import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchDnsScripts } from "./api.ts";

const COMMAND = "list";
const DESCRIPTION = "List Scriptable DNS scripts.";

/**
 * List all Scriptable DNS scripts in the account.
 *
 * @example
 * ```bash
 * bunny dns scripts list
 *
 * bunny dns scripts list --output json
 * ```
 */
export const dnsScriptsListCommand = defineCommand({
  command: COMMAND,
  aliases: ["ls"],
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts list", "List DNS scripts"],
    ["$0 dns scripts list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching DNS scripts...");
    spin.start();
    const scripts = await fetchDnsScripts(client);
    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(scripts, null, 2));
      return;
    }

    if (scripts.length === 0) {
      logger.info("No DNS scripts found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name"],
        scripts.map((script) => [String(script.Id ?? ""), script.Name ?? ""]),
        output,
      ),
    );
  },
});
