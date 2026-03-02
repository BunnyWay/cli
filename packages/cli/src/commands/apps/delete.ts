import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { resolveAppId } from "./toml.ts";
import { clientOptions } from "../../core/client-options.ts";

const COMMAND = "delete";
const DESCRIPTION = "Delete an app.";

interface DeleteArgs {
  id?: string;
  force?: boolean;
}

export const appsDeleteCommand = defineCommand<DeleteArgs>({
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
        describe: "Skip confirmation prompt",
      }),

  handler: async ({ id: rawId, force, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    if (!force) {
      const confirmed = await confirm(
        "Are you sure you want to delete this app? This cannot be undone.",
      );
      if (!confirmed) {
        logger.log("Delete cancelled.");
        return;
      }
    }

    const spin = spinner("Deleting app...");
    spin.start();

    await client.DELETE("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, deleted: true }));
      return;
    }

    logger.success("App deleted.");
  },
});
