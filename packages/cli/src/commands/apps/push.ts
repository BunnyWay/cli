import type { RegistryMap } from "@bunny.net/app-config";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { configToPatchRequest, loadConfig, resolveAppId } from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

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
    const config = resolveConfig(profile, apiKey, verbose);
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

    // Pull registry IDs from the manifest so the patch body still
    // carries `imageRegistryId` per container - these don't live in
    // bunny.jsonc anymore. Fall back to whatever the existing template
    // already had (no-op change) when the manifest doesn't know.
    const manifest = loadManifest<AppManifest>(APP_MANIFEST);
    const registries: RegistryMap = {};
    for (const ct of existingApp.containerTemplates) {
      const fromManifest = manifest.containers?.[ct.name]?.registry;
      registries[ct.name] =
        fromManifest ??
        (ct.imageRegistryId && ct.imageRegistryId !== "0"
          ? ct.imageRegistryId
          : undefined);
    }

    const patchRequest = configToPatchRequest(toml, existingApp, registries);

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
