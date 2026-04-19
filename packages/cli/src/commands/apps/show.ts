import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { resolveAppId } from "./config.ts";
import { STATUS_LABELS } from "./constants.ts";

const COMMAND = "show";
const DESCRIPTION = "Show app details.";

interface ShowArgs {
  id?: string;
}

export const appsShowCommand = defineCommand<ShowArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs.option("id", {
      type: "string",
      describe: "App ID (overrides bunny.jsonc)",
    }),

  handler: async ({ id: rawId, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching app...");
    spin.start();

    const [appResult, overviewResult] = await Promise.all([
      client.GET("/apps/{appId}", { params: { path: { appId } } }),
      client.GET("/apps/{appId}/overview", { params: { path: { appId } } }),
    ]);

    spin.stop();

    const app = appResult.data;
    const overview = overviewResult.data;

    if (!app) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    if (output === "json") {
      logger.log(JSON.stringify({ ...app, overview }, null, 2));
      return;
    }

    const status = STATUS_LABELS[app.status] ?? app.status;

    const entries = [
      { key: "ID", value: app.id },
      { key: "Name", value: app.name },
      { key: "Status", value: status },
      {
        key: "Regions",
        value: app.regionSettings.requiredRegionIds.join(", ") || "None",
      },
    ];

    if (app.autoScaling) {
      entries.push({
        key: "Scaling",
        value: `${app.autoScaling.min}–${app.autoScaling.max} instances`,
      });
    }

    if (overview?.monthlyCost !== undefined) {
      entries.push({
        key: "Monthly Cost",
        value: `$${overview.monthlyCost.toFixed(2)}`,
      });
    }

    if (overview?.activeInstances) {
      entries.push({
        key: "Active Instances",
        value: String(overview.activeInstances.indicator ?? 0),
      });
    }

    logger.log(formatKeyValue(entries, output));

    if (app.containerTemplates.length > 0) {
      logger.log();
      logger.info("Containers:");

      const containerRows = app.containerTemplates.map((c) => {
        const endpoint = c.endpoints?.[0]?.publicHost ?? "";
        return [c.name, c.image, endpoint];
      });

      logger.log(
        formatTable(["Name", "Image", "Endpoint"], containerRows, output),
      );
    }
  },
});
