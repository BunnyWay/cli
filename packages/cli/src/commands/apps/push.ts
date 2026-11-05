import type { RegistryMap } from "@bunny.net/config";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import { spinner } from "@/core/ui.ts";
import {
  assertVolumesNotSplit,
  configToPatchRequest,
  loadConfig,
  resolveAppId,
} from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";
import { resolveRegistryForImage } from "./docker.ts";
import { confirmRemovals, pruneManifestContainers } from "./removals.ts";

const COMMAND = "push";
const DESCRIPTION = "Apply local bunny.jsonc config to remote app.";

interface PushArgs {
  "dry-run"?: boolean;
  "allow-split-volumes"?: boolean;
  force?: boolean;
}

export const appsPushCommand = defineCommand<PushArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("dry-run", {
        type: "boolean",
        describe: "Show what would change without applying",
      })
      .option("allow-split-volumes", {
        type: "boolean",
        describe:
          "Apply a volume in more than one region or instance, each keeping its own separate data",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Remove containers or volumes without confirming",
      }),

  handler: async ({
    "dry-run": dryRun,
    "allow-split-volumes": allowSplitVolumes,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId();
    const toml = loadConfig();
    assertVolumesNotSplit(toml, allowSplitVolumes);
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

    let patchRequest = configToPatchRequest(toml, existingApp, registries);

    if (
      !dryRun &&
      !(await confirmRemovals(patchRequest, existingApp, force, output))
    ) {
      logger.log("Push cancelled.");

      return;
    }

    const added = (patchRequest.containerTemplates ?? []).filter(
      (ct) => !ct.imageRegistryId,
    );

    for (const { name } of added) {
      const image = toml.app.containers[name]?.image;
      if (!image) {
        throw new UserError(
          `Container "${name}" is new and builds from a Dockerfile.`,
          "Run `bunny apps deploy` to build and add it.",
        );
      }

      if (dryRun) continue;

      const registry = await resolveRegistryForImage(client, image);
      if (!registry) {
        throw new UserError(`A registry is required for ${image}.`);
      }

      registries[name] = registry.id;
    }

    if (added.length > 0 && !dryRun) {
      patchRequest = configToPatchRequest(toml, existingApp, registries);
    }

    if (dryRun) {
      if (output === "json") {
        logger.log(JSON.stringify(patchRequest, null, 2));
        return;
      }

      const changes: string[] = [];
      if (patchRequest.name !== existingApp.name) {
        changes.push(`Name: ${existingApp.name} → ${patchRequest.name}`);
      }

      const sent = patchRequest.containerTemplates ?? [];
      const keptIds = new Set(sent.map((ct) => ct.id));

      for (const ct of sent) {
        if (!ct.id) changes.push(`Container added: ${ct.name}`);
      }

      for (const ct of existingApp.containerTemplates) {
        if (!keptIds.has(ct.id)) changes.push(`Container removed: ${ct.name}`);
      }

      const endpointCount = (patchRequest.containerTemplates ?? []).reduce(
        (n, ct) => n + (ct.endpoints?.length ?? 0),
        0,
      );
      const existingEndpoints = existingApp.containerTemplates.reduce(
        (n, ct) => n + ct.endpoints.length,
        0,
      );

      if (endpointCount !== existingEndpoints) {
        changes.push(`Endpoints: ${existingEndpoints} → ${endpointCount}`);
      }

      const volumeCount = patchRequest.volumes?.length ?? 0;
      const existingVolumes = existingApp.volumes.length;
      if (volumeCount !== existingVolumes) {
        changes.push(`Volumes: ${existingVolumes} → ${volumeCount}`);
      }

      if (changes.length === 0) {
        logger.info("Dry run: no changes in names or counts.");

        return;
      }

      logger.info("Dry run — changes that would be applied:");
      logger.log();
      for (const change of changes) logger.log(`  ${change}`);
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

    const containers = pruneManifestContainers(
      manifest.containers,
      Object.keys(toml.app.containers),
    );

    for (const { name } of added) {
      containers[name] = { ...containers[name], registry: registries[name] };
    }

    saveManifest<AppManifest>(APP_MANIFEST, {
      ...manifest,
      id: appId,
      containers,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, pushed: true }));
      return;
    }

    logger.success("App config updated from bunny.jsonc.");
  },
});
