import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type BunnyAppConfig,
  BunnyAppConfigSchema,
  migrate,
} from "@bunny.net/app-config";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import { parse as parseJsonc } from "jsonc-parser";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";

type Application = components["schemas"]["Application"];

const CONFIG_FILENAME = "bunny.jsonc";

// Re-export types and conversion functions for convenience
export type {
  BunnyAppConfig,
  ContainerConfig,
  RegionsConfig,
} from "@bunny.net/app-config";
export {
  apiToConfig,
  CURRENT_VERSION,
  configToAddRequest,
  configToPatchRequest,
  normalizeRegions,
  parseImageRef,
} from "@bunny.net/app-config";

function findConfigRoot(): string {
  let dir = resolve(process.cwd());

  while (true) {
    if (existsSync(join(dir, CONFIG_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Load and parse bunny.jsonc from cwd or nearest ancestor. */
export function loadConfig(): BunnyAppConfig {
  const root = findConfigRoot();
  const jsoncPath = join(root, CONFIG_FILENAME);

  if (existsSync(jsoncPath)) {
    const raw = readFileSync(jsoncPath, "utf-8");
    return parseAndMigrate(parseJsonc(raw));
  }

  throw new UserError("No bunny.jsonc found.", "Run `bunny apps init` first.");
}

/** Apply schema migrations then validate. Logs when a migration ran. */
function parseAndMigrate(raw: unknown): BunnyAppConfig {
  const { config, migratedFrom } = migrate(raw);
  if (migratedFrom) {
    logger.dim(
      `Migrated bunny.jsonc from version "${migratedFrom}". Run \`bunny apps push\` to save the new format.`,
    );
  }
  return BunnyAppConfigSchema.parse(config);
}

/** Write bunny.jsonc to the given directory (or cwd). */
export function saveConfig(data: BunnyAppConfig, dir?: string): void {
  const target = dir ?? process.cwd();
  const path = join(target, CONFIG_FILENAME);

  // Re-key the object so the file always starts with $schema → version → app.
  const { $schema: _schema, version, ...rest } = data;
  const output = {
    $schema: "./node_modules/@bunny.net/app-config/generated/schema.json",
    version,
    ...rest,
  };

  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
}

/** Check if bunny.jsonc exists in cwd or ancestor. */
export function configExists(): boolean {
  const root = findConfigRoot();
  return existsSync(join(root, CONFIG_FILENAME));
}

/**
 * Resolve an app ID from an explicit value or from bunny.jsonc.
 * Throws if neither source provides an ID.
 */
export function resolveAppId(explicit?: string): string {
  if (explicit) return explicit;

  const config = loadConfig();
  if (config.app.id) return config.app.id;

  throw new UserError(
    "No app ID found in bunny.jsonc.",
    "Run `bunny apps deploy` to create the app first, or pass --id explicitly.",
  );
}

/**
 * Resolve a container template ID by name.
 * Defaults to the first container (primary) if no name is given.
 */
export function resolveContainerId(
  app: Application,
  containerName?: string,
): string {
  if (!containerName) {
    const primary = app.containerTemplates[0];
    if (!primary) {
      throw new UserError("App has no containers.");
    }
    return primary.id;
  }

  const found = app.containerTemplates.find(
    (c) => c.name.toLowerCase() === containerName.toLowerCase(),
  );

  if (!found) {
    const available = app.containerTemplates.map((c) => c.name).join(", ");
    throw new UserError(
      `Container "${containerName}" not found.`,
      `Available containers: ${available}`,
    );
  }

  return found.id;
}
