import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import {
  apiToConfig,
  configExists,
  resolveAppId,
  saveConfig,
} from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

const COMMAND = "pull";
const DESCRIPTION = "Sync remote app config to local bunny.jsonc.";

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
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Overwrite bunny.jsonc without prompting",
      }),

  handler: async ({ id: rawId, force, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    if (configExists() && !force) {
      const confirmed = await confirm(
        "bunny.jsonc already exists. Overwrite with remote config?",
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

    const toml = apiToConfig(app);
    saveConfig(toml);

    // Mirror identity into `.bunny/app.json` so subsequent commands
    // don't fall back to legacy `app.id`/`container.registry` reads from
    // bunny.jsonc (those fields are stripped on the next save).
    const manifestContainers: AppManifest["containers"] = {};
    for (const ct of app.containerTemplates) {
      manifestContainers[ct.name] = {
        id: ct.id,
        registry:
          ct.imageRegistryId && ct.imageRegistryId !== "0"
            ? ct.imageRegistryId
            : undefined,
      };
    }
    saveManifest<AppManifest>(APP_MANIFEST, {
      id: appId,
      profile: profile ?? "default",
      containers: manifestContainers,
    });

    if (output === "json") {
      logger.log(JSON.stringify(toml, null, 2));
      return;
    }

    logger.success("bunny.jsonc updated from remote.");
    logger.dim(`Linked to ${appId} → .bunny/${APP_MANIFEST}`);
  },
});
