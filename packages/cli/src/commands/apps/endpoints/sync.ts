import { apiToConfig } from "@bunny.net/config";
import type { createMcClient } from "@bunny.net/openapi-client";
import { configPath } from "@/core/bunny-config.ts";
import { loadManifest } from "@/core/manifest.ts";
import { configExists, loadConfig, saveConfig } from "../config.ts";
import { APP_MANIFEST, type AppManifest } from "../constants.ts";

/** Copy the app's endpoints into the linked bunny.jsonc so the next push or deploy keeps them. */
export async function syncEndpointsToConfig(
  client: ReturnType<typeof createMcClient>,
  appId: string,
): Promise<void> {
  if (!configExists() || loadManifest<AppManifest>(APP_MANIFEST).id !== appId) {
    return;
  }

  const { data: app } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });

  if (!app) return;

  const remote = apiToConfig(app).app.containers;
  const local = loadConfig();

  for (const [name, container] of Object.entries(local.app.containers)) {
    const endpoints = remote[name]?.endpoints;
    if (endpoints?.length) container.endpoints = endpoints;
    else delete container.endpoints;
  }

  saveConfig(local, configPath());
}
