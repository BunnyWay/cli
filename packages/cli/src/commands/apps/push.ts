import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { configToPatchRequest, loadConfig, resolveAppId } from "./config.ts";

const COMMAND = "push";
const DESCRIPTION = "Apply local bunny.jsonc config to remote app.";

interface PushArgs {
  "dry-run"?: boolean;
}

export const appsPushCommand = defineCommand<PushArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs.option("dry-run", {
      type: "boolean",
      describe: "Show what would change without applying",
    }),

  handler: async ({ "dry-run": dryRun, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId();
    const toml = loadConfig();
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching current app state...");
    spin.start();

    const { data: existingApp } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (!existingApp) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    const patchRequest = configToPatchRequest(toml, existingApp);

    if (dryRun) {
      if (output === "json") {
        logger.log(JSON.stringify(patchRequest, null, 2));
        return;
      }

      logger.info("Dry run — changes that would be applied:");
      logger.log();

      if (patchRequest.name !== existingApp.name) {
        logger.log(`  Name: ${existingApp.name} → ${patchRequest.name}`);
      }

      const containerCount = patchRequest.containerTemplates?.length ?? 0;
      const existingCount = existingApp.containerTemplates.length;
      if (containerCount !== existingCount) {
        logger.log(`  Containers: ${existingCount} → ${containerCount}`);
      }

      const volumeCount = patchRequest.volumes?.length ?? 0;
      const existingVolumes = existingApp.volumes.length;
      if (volumeCount !== existingVolumes) {
        logger.log(`  Volumes: ${existingVolumes} → ${volumeCount}`);
      }

      logger.log();
      logger.dim("Run without --dry-run to apply.");
      return;
    }

    const pushSpin = spinner("Pushing config...");
    pushSpin.start();

    await client.PATCH("/apps/{appId}", {
      params: { path: { appId } },
      body: patchRequest,
    });

    pushSpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, pushed: true }));
      return;
    }

    logger.success("App config updated from bunny.jsonc.");
  },
});
