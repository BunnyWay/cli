import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { resolveAppId } from "./config.ts";

const COMMAND = "undeploy";
const DESCRIPTION = "Undeploy an app.";

interface UndeployArgs {
  id?: string;
  force?: boolean;
}

export const appsUndeployCommand = defineCommand<UndeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({ id: rawId, force, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    if (!force) {
      const confirmed = await confirm(
        "Are you sure you want to undeploy this app?",
      );
      if (!confirmed) {
        logger.log("Undeploy cancelled.");
        return;
      }
    }

    const spin = spinner("Undeploying app...");
    spin.start();

    await client.POST("/apps/{appId}/undeploy", {
      params: { path: { appId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, undeployed: true }));
      return;
    }

    logger.success("App undeployed.");
  },
});
