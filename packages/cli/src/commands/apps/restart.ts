import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { resolveAppId } from "./config.ts";

const COMMAND = "restart";
const DESCRIPTION = "Restart an app.";

interface RestartArgs {
  id?: string;
}

export const appsRestartCommand = defineCommand<RestartArgs>({
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
  },
});
