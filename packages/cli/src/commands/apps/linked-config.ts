import { join } from "node:path";
import { CONFIG_FILENAME, findConfigRoot } from "@/core/bunny-config.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, manifestRoot } from "@/core/manifest.ts";
import { type BunnyAppConfig, loadConfig, saveConfig } from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

/** Apply `edit` to the bunny.jsonc linked to `appId`, skipping configs that belong to another app or project. */
export function updateLinkedConfig(
  appId: string,
  edit: (config: BunnyAppConfig) => boolean,
): void {
  const root = findConfigRoot();
  if (!root) return;

  let config: BunnyAppConfig;
  try {
    config = loadConfig();
  } catch {
    logger.warn("bunny.jsonc is invalid, so it wasn't updated to match.");
    return;
  }
  const manifestId = loadManifest<AppManifest>(APP_MANIFEST).id;
  const linked = manifestId
    ? manifestId === appId && manifestRoot(APP_MANIFEST) === root
    : config.app.id === appId;

  if (linked && edit(config)) saveConfig(config, join(root, CONFIG_FILENAME));
}
