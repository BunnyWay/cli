import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";
import { clientOptions } from "../../../core/client-options.ts";

const COMMAND = "list";
const DESCRIPTION = "List accessories for an app.";

interface ListArgs {
  id?: string;
}

export const appsAccessoryListCommand = defineCommand<ListArgs>({
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
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching app...");
    spin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (!app) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    const primaryId = app.containerTemplates[0]?.id;
    const accessories = app.containerTemplates.filter((c) => c.id !== primaryId);

    if (output === "json") {
      logger.log(JSON.stringify(accessories, null, 2));
      return;
    }

    if (accessories.length === 0) {
      logger.info("No accessories found.");
      return;
    }

    const rows = accessories.map((c) => [
      c.name,
      c.imageName,
      c.imageTag,
    ]);

    logger.log(formatTable(["Name", "Image", "Tag"], rows, output));
  },
});
