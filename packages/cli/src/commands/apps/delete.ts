import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, removeManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { resolveAppId } from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

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
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({ id: rawId, force, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey, verbose);
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

    // If this delete matches the manifest-linked app, drop the manifest
    // so the next deploy doesn't try to PATCH a now-deleted app ID.
    if (loadManifest<AppManifest>(APP_MANIFEST).id === appId) {
      removeManifest(APP_MANIFEST);
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, deleted: true }));
      return;
    }

    logger.success("App deleted.");
  },
});
