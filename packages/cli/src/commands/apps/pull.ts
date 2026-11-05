import { dirname, join } from "node:path";
import { BunnyAppConfigSchema, BunnyConfigSchema } from "@bunny.net/config";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { configPath, readBunnyConfig } from "@/core/bunny-config.ts";
import { resolveRegistryEndpoint } from "@/core/bunny-registry.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { saveManifest } from "@/core/manifest.ts";
import { confirm, spinner } from "@/core/ui.ts";
import {
  apiToConfig,
  type BunnyAppConfig,
  configExists,
  resolveAppId,
  saveConfig,
} from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";
import { BUNNY_REGISTRY_ID, listRegistries } from "./docker.ts";
import { resolveContainerEnv } from "./env/resolve.ts";

// Keep what the API doesn't store: the sites block, build settings, and env entries (like .env pointers) that still resolve to the remote value.
function keepLocalIntent(remote: BunnyAppConfig, path: string): BunnyAppConfig {
  const parsed = BunnyConfigSchema.safeParse(readBunnyConfig(path)?.data);
  if (!parsed.success) return remote;

  const local = parsed.data;
  if (local.sites) remote.sites = local.sites;

  const localApp = BunnyAppConfigSchema.safeParse(local);
  if (!localApp.success) return remote;

  const resolved = resolveContainerEnv(
    localApp.data,
    join(dirname(path), ".env"),
  );
  for (const [name, container] of Object.entries(remote.app.containers)) {
    const before = localApp.data.app.containers[name];
    if (!before) continue;

    if (before.dockerfile) container.dockerfile = before.dockerfile;
    if (before.context) container.context = before.context;

    const resolvedEnv = resolved.app.containers[name]?.env ?? {};
    for (const [key, value] of Object.entries(container.env ?? {})) {
      const raw = before.env?.[key];
      if (raw !== undefined && resolvedEnv[key] === value && container.env) {
        container.env[key] = raw;
      }
    }
  }

  return remote;
}

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

    const [{ data: app }, registries] = await Promise.all([
      client.GET("/apps/{appId}", { params: { path: { appId } } }),
      listRegistries(client),
    ]);

    spin.stop();

    if (!app) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    const registryHosts = Object.fromEntries(
      registries.map((r) => [
        String(r.id),
        String(r.id) === BUNNY_REGISTRY_ID
          ? resolveRegistryEndpoint().host
          : (r.hostName ?? ""),
      ]),
    );
    const target = configPath();
    const toml = keepLocalIntent(apiToConfig(app, registryHosts), target);
    saveConfig(toml, target);

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
