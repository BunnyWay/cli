import type { createMcClient } from "@bunny.net/openapi-client";
import { configPath } from "@/core/bunny-config.ts";
import { loadManifest } from "@/core/manifest.ts";
import { configExists, loadConfig, saveConfig } from "../config.ts";
import { APP_MANIFEST, type AppManifest } from "../constants.ts";

export async function volumeName(
  client: ReturnType<typeof createMcClient>,
  appId: string,
  volumeId: string,
): Promise<string | undefined> {
  const { data } = await client.GET("/apps/{appId}/volumes", {
    params: { path: { appId } },
  });

  return data?.items?.find((v) => v.id === volumeId)?.name ?? undefined;
}

export function removeVolumeFromConfig(appId: string, name: string): void {
  if (!configExists() || loadManifest<AppManifest>(APP_MANIFEST).id !== appId) {
    return;
  }

  const local = loadConfig();

  for (const container of Object.values(local.app.containers)) {
    const volumes = container.volumes?.filter((v) => v.name !== name);

    if (volumes?.length) container.volumes = volumes;
    else delete container.volumes;
  }

  saveConfig(local, configPath());
}
