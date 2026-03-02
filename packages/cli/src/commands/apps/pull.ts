import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { clientOptions } from "../../core/client-options.ts";
import {
  resolveAppId,
  apiToToml,
  bunnyTomlExists,
  saveBunnyToml,
} from "./toml.ts";

const COMMAND = "pull";
const DESCRIPTION = "Sync remote app config to local bunny.toml.";

interface PullArgs {
  id?: string;
  force?: boolean;
}

export const appsPullCommand = defineCommand<PullArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Overwrite bunny.toml without prompting",
      }),

  handler: async ({ id: rawId, force, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    if (bunnyTomlExists() && !force) {
      const confirmed = await confirm(
        "bunny.toml already exists. Overwrite with remote config?",
      );
      if (!confirmed) {
        logger.log("Pull cancelled.");
        return;
      }
    }

    const spin = spinner("Pulling app config...");
    spin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (!app) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    const toml = apiToToml(app);
    saveBunnyToml(toml);

    if (output === "json") {
      logger.log(JSON.stringify(toml, null, 2));
      return;
    }

    logger.success("bunny.toml updated from remote.");
  },
});
