import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type BunnyAppConfig,
  BunnyAppConfigSchema,
} from "@bunny.net/app-config";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import { parse as parseJsonc } from "jsonc-parser";
import { UserError } from "../../core/errors.ts";

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

/**
 * Load and parse the app config.
 *
 * When `explicitPath` is given (e.g. from `--config <path>`), that file
 * is loaded verbatim. Otherwise we walk up from cwd looking for
 * `bunny.jsonc`.
 */
export function loadConfig(explicitPath?: string): BunnyAppConfig {
  const jsoncPath = explicitPath ?? join(findConfigRoot(), CONFIG_FILENAME);

  if (!existsSync(jsoncPath)) {
    throw new UserError(
      `No config file found at ${jsoncPath}.`,
      "Run `bunny apps init` first, or pass --config <path>.",
    );
  }

  const raw = parseJsonc(readFileSync(jsoncPath, "utf-8"));
  if (raw && typeof raw === "object" && !("version" in raw)) {
    throw new UserError(
      `${jsoncPath} is missing the \`version\` field.`,
      "Run `bunny apps pull` to regenerate it from the remote app.",
    );
  }
  return BunnyAppConfigSchema.parse(raw);
}

/**
 * Write the app config.
 *
 * When `explicitPath` is given the file is written exactly there;
 * otherwise we write to `./bunny.jsonc` in the current working
 * directory. The `--config <path>` flow uses the explicit form so that
 * deploys can persist `app.id` back to whatever file the caller chose.
 */
export function saveConfig(data: BunnyAppConfig, explicitPath?: string): void {
  const path = explicitPath ?? join(process.cwd(), CONFIG_FILENAME);

  // Re-key the object so the file always starts with $schema → version → app.
  const { $schema: _schema, version, ...rest } = data;
  const output = {
    $schema: "./node_modules/@bunny.net/app-config/generated/schema.json",
    version,
    ...rest,
  };

  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
}

/**
 * Check whether an app config exists.
 *
 * When `explicitPath` is given we check that exact file; otherwise we
 * walk up from cwd looking for `bunny.jsonc`.
 */
export function configExists(explicitPath?: string): boolean {
  if (explicitPath) return existsSync(explicitPath);
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
