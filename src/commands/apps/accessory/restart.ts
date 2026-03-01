import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";

const COMMAND = "restart [name]";
const DESCRIPTION = "Restart accessory containers.";

interface RestartArgs {
  name?: string;
  id?: string;
}

export const appsAccessoryRestartCommand = defineCommand<RestartArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Accessory name (restarts all containers)",
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      }),

  handler: async ({ id: rawId, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const spin = spinner("Restarting app...");
    spin.start();

    await client.POST("/apps/{appId}/restart", {
      params: { path: { appId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, restarted: true }));
      return;
    }

    logger.success("App restarted.");
    logger.dim("Note: restart applies to all containers in the app.");
  },
});
