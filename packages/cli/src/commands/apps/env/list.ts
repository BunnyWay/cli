import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId, resolveContainerId } from "../config.ts";

const COMMAND = "list";
const DESCRIPTION = "List environment variables.";

interface ListArgs {
  id?: string;
  container?: string;
}

export const appsEnvListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  aliases: ["ls"],

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("container", {
        type: "string",
        describe: "Container name (defaults to primary)",
      }),

  handler: async ({
    id: rawId,
    container: containerName,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching environment variables...");
    spin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (!app) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    const containerId = resolveContainerId(app, containerName);
    const container = app.containerTemplates.find((c) => c.id === containerId);
    const vars = container?.environmentVariables ?? [];

    if (output === "json") {
      logger.log(JSON.stringify(vars, null, 2));
      return;
    }

    if (vars.length === 0) {
      logger.info("No environment variables set.");
      return;
    }

    const rows = vars.map((v) => [v.name, v.value ?? ""]);

    logger.log(formatTable(["Name", "Value"], rows, output));
  },
});
