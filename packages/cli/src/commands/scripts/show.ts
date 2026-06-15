import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../core/format.ts";
import { hostnameUrl, toSafeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { fetchScriptHostnames } from "./api.ts";
import { scriptTypeLabel } from "./constants.ts";
import {
  type ScriptSelectorArgs,
  scriptSelectorBuilder,
  selectScript,
} from "./interactive.ts";

const COMMAND = "show [id]";
const DESCRIPTION = "Show details of an Edge Script.";

type ShowArgs = ScriptSelectorArgs;

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

  builder: (yargs) => scriptSelectorBuilder(yargs),

  handler: async ({ id: rawId, link, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const client = createComputeClient(options);

    const { script, offerLink } = await selectScript(client, {
      id: rawId,
      link,
      output,
    });

    const spin = spinner("Fetching hostnames...");
    spin.start();

    // Pull each linked pull zone's hostnames (incl. custom domains + SSL state).
    const coreClient = createCoreClient(options);
    const hostnames = await fetchScriptHostnames(coreClient, script, verbose);

    spin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { ...script, Hostnames: hostnames.map(toSafeHostname) },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(script.Id ?? "") },
          { key: "Name", value: script.Name ?? "" },
          {
            key: "Type",
            value: scriptTypeLabel(script.ScriptType),
          },
          { key: "Default Hostname", value: script.DefaultHostname ?? "" },
          { key: "System Hostname", value: script.SystemHostname ?? "" },
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

    if (hostnames.length > 0) {
      logger.log();
      logger.log("Hostnames:");
      logger.log(
        formatTable(
          ["Hostname", "Type", "SSL", "Force SSL"],
          hostnames.map((h) => [
            hostnameUrl(h.Value ?? "", {
              hasCertificate: h.HasCertificate,
              forceSSL: h.ForceSSL,
            }),
            h.IsSystemHostname ? "System" : "Custom",
            h.HasCertificate ? "Yes" : "No",
            h.ForceSSL ? "Yes" : "No",
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

    await offerLink();
  },
});
