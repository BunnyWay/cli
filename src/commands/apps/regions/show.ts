import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";

const COMMAND = "show";
const DESCRIPTION = "Show region settings for an app.";

interface ShowArgs {
  id?: string;
}

export const appsRegionsShowCommand = defineCommand<ShowArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs.option("id", {
      type: "string",
      describe: "App ID (overrides bunny.toml)",
    }),

  handler: async ({ id: rawId, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const spin = spinner("Fetching region settings...");
    spin.start();

    const { data } = await client.GET("/apps/{appId}/region-settings", {
      params: { path: { appId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(data, null, 2));
      return;
    }

    const entries = [
      {
        key: "Allowed Regions",
        value: data?.allowedRegionIds?.join(", ") || "None",
      },
      {
        key: "Required Regions",
        value: data?.requiredRegionIds?.join(", ") || "None",
      },
    ];

    if (data?.maxAllowedRegions != null) {
      entries.push({
        key: "Max Allowed Regions",
        value: String(data.maxAllowedRegions),
      });
    }

    logger.log(formatKeyValue(entries, output));
  },
});
