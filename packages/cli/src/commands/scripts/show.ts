import { createComputeClient } from "@bunny.net/api";
import type { components } from "@bunny.net/api/generated/compute.d.ts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { resolveManifestId } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { SCRIPT_MANIFEST, SCRIPT_TYPE_LABELS } from "./constants.ts";

type EdgeScript = components["schemas"]["EdgeScriptModel"];

const COMMAND = "show [id]";
const DESCRIPTION = "Show details of an Edge Script.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";

interface ShowArgs {
  [ARG_ID]?: EdgeScript["Id"];
}

/**
 * Show details of an Edge Script.
 *
 * Displays script metadata, linked pull zones, and environment variables.
 * Falls back to the linked script ID from the local manifest when no
 * explicit ID is provided.
 *
 * @example
 * ```bash
 * # Show linked script
 * bunny scripts show
 *
 * # Show a specific script by ID
 * bunny scripts show 12345
 *
 * # JSON output
 * bunny scripts show --output json
 * ```
 */
export const scriptsShowCommand = defineCommand<ShowArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts show", "Show linked script"],
    ["$0 scripts show 12345", "Show a specific script"],
    ["$0 scripts show --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_ID, {
      type: "number",
      describe: ARG_ID_DESCRIPTION,
    }),

  handler: async ({ [ARG_ID]: rawId, profile, output, verbose, apiKey }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching Edge Script...");
    spin.start();

    const { data: script } = await client.GET("/compute/script/{id}", {
      params: { path: { id } },
    });

    spin.stop();

    if (!script) {
      logger.error("Edge Script not found.");
      process.exit(1);
    }

    if (output === "json") {
      logger.log(JSON.stringify(script, null, 2));
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(script.Id ?? "") },
          { key: "Name", value: script.Name ?? "" },
          {
            key: "Type",
            value: SCRIPT_TYPE_LABELS[script.ScriptType ?? -1] ?? "Unknown",
          },
          { key: "Default Hostname", value: script.DefaultHostname ?? "" },
          { key: "System Hostname", value: script.SystemHostname ?? "" },
          { key: "Deployment Key", value: script.DeploymentKey ?? "" },
          {
            key: "Current Release",
            value: String(script.CurrentReleaseId ?? "—"),
          },
          { key: "Last Modified", value: script.LastModified ?? "" },
          {
            key: "Monthly Requests",
            value: String(script.MonthlyRequestCount ?? 0),
          },
          { key: "Monthly CPU Time", value: `${script.MonthlyCpuTime ?? 0}ms` },
          {
            key: "Monthly Cost",
            value: `$${(script.MonthlyCost ?? 0).toFixed(2)}`,
          },
        ],
        output,
      ),
    );

    const pullzones = script.LinkedPullZones ?? [];
    if (pullzones.length > 0) {
      logger.log();
      logger.log("Linked Pull Zones:");
      logger.log(
        formatTable(
          ["ID", "Name", "Hostname"],
          pullzones.map((pz) => [
            String(pz.Id ?? ""),
            pz.PullZoneName ?? "",
            pz.DefaultHostname ?? "",
          ]),
          output,
        ),
      );
    }

    const variables = script.EdgeScriptVariables ?? [];
    if (variables.length > 0) {
      logger.log();
      logger.log("Environment Variables:");
      logger.log(
        formatTable(
          ["ID", "Name", "Default Value", "Required"],
          variables.map((v) => [
            String(v.Id ?? ""),
            v.Name ?? "",
            v.DefaultValue ?? "",
            v.Required ? "Yes" : "No",
          ]),
          output,
        ),
      );
    }
  },
});
