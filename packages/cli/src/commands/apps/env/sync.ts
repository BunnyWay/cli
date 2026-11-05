import { join } from "node:path";
import { CONFIG_FILENAME, findConfigRoot } from "@/core/bunny-config.ts";
import { logger } from "@/core/logger.ts";
import { updateLinkedConfig } from "../linked-config.ts";
import { resolveContainerEnv } from "./resolve.ts";

// Drop removed keys from the linked bunny.jsonc env block so the next deploy doesn't add them back.
export function removeEnvFromConfig(
  appId: string,
  containerName: string,
  keys: string[],
): void {
  updateLinkedConfig(appId, (config) => {
    const container = config.app.containers[containerName];
    const env = container?.env;
    if (!container || !env || !keys.some((key) => key in env)) return false;

    for (const key of keys) delete env[key];
    if (Object.keys(env).length === 0) delete container.env;
    return true;
  });
}

// Warn when the linked bunny.jsonc env block would undo these values on the next deploy or push.
export function warnEnvOverriddenByConfig(
  appId: string,
  containerName: string,
  vars: Record<string, string>,
): void {
  const root = findConfigRoot();
  if (!root) return;

  updateLinkedConfig(appId, (config) => {
    if (!config.app.containers[containerName]?.env) return false;

    const resolved = resolveContainerEnv(config, join(root, ".env")).app
      .containers[containerName]?.env;
    const lost = Object.keys(vars).filter(
      (key) => resolved?.[key] !== vars[key],
    );
    if (lost.length === 0) return false;

    logger.warn(
      `${CONFIG_FILENAME} sets the env for container "${containerName}", so the next deploy or push will undo ${lost.join(", ")}.`,
    );
    logger.dim(
      `Add each key to its env block (e.g. "${lost[0]}": "${lost[0]}" with the value in .env) to keep it.`,
    );
    return false;
  });
}
