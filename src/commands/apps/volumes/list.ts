import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";

const COMMAND = "list";
const DESCRIPTION = "List volumes.";

interface ListArgs {
  id?: string;
}

export const appsVolumesListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  aliases: ["ls"],

  builder: (yargs) =>
    yargs.option("id", {
      type: "string",
      describe: "App ID (overrides bunny.toml)",
    }),

  handler: async ({ id: rawId, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const spin = spinner("Fetching volumes...");
    spin.start();

    const { data } = await client.GET("/apps/{appId}/volumes", {
      params: { path: { appId } },
    });

    spin.stop();

    const volumes = data?.items ?? [];

    if (output === "json") {
      logger.log(JSON.stringify(volumes, null, 2));
      return;
    }

    if (volumes.length === 0) {
      logger.info("No volumes found.");
      return;
    }

    const rows = volumes.map((v) => [
      v.name ?? "",
      v.id ?? "",
      `${v.size ?? 0} GB`,
      `${v.totalUsage?.toFixed(1) ?? 0} GB`,
      String(v.attachedInstancesCount ?? 0),
    ]);

    logger.log(
      formatTable(["Name", "ID", "Size", "Usage", "Attached"], rows, output),
    );
  },
});
