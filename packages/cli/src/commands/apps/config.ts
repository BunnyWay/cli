import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type BunnyAppConfig,
  BunnyAppConfigSchema,
} from "@bunny.net/app-config";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import { parse as parseJsonc } from "jsonc-parser";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest } from "../../core/manifest.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

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
 * Strip fields that should never be persisted to `bunny.jsonc`.
 *
 * `bunny.jsonc` stores deploy *intent* - name, containers, env, regions,
 * scaling. Anything that's account-scoped identity or per-build artifact
 * lives in `.bunny/app.json` (see `apps/constants.ts` + `core/manifest.ts`) instead, so the
 * config file stays committable and stable across a team:
 *
 * - `app.id` - MC app ID is per-account.
 * - `containers[name].registry` - registry record IDs are per-account.
 * - `containers[name].image` when the container builds from a `dockerfile`
 *   - the tag changes every build and the MC API is the source of truth.
 *
 * For containers with only `image` (a pre-built ref the user pinned
 * intentionally, e.g. `nginx:1.27`), `image` is preserved - it's a
 * universally resolvable upstream reference.
 *
 * Exposed for testing; production callers should use {@link saveConfig}.
 */
export function stripTransientFields(data: BunnyAppConfig): BunnyAppConfig {
  const containers: BunnyAppConfig["app"]["containers"] = {};
  for (const [name, c] of Object.entries(data.app.containers)) {
    const { registry: _registry, ...withoutRegistry } = c;
    if (c.dockerfile) {
      const { image: _image, ...rest } = withoutRegistry;
      containers[name] = rest;
    } else {
      containers[name] = withoutRegistry;
    }
  }
  const { id: _id, ...appWithoutId } = data.app;
  return {
    ...data,
    app: { ...appWithoutId, containers },
  };
}

/**
 * Write the app config.
 *
 * When `explicitPath` is given the file is written exactly there;
 * otherwise we write to `./bunny.jsonc` in the current working
 * directory. The `--config <path>` flow uses the explicit form so that
 * deploys can persist `app.id` back to whatever file the caller chose.
 *
 * Transient fields (see {@link stripTransientFields}) are removed before
 * write - callers can freely mutate the in-memory `image` field during a
 * deploy without polluting the on-disk config.
 */
export function saveConfig(data: BunnyAppConfig, explicitPath?: string): void {
  const path = explicitPath ?? join(process.cwd(), CONFIG_FILENAME);
  const cleaned = stripTransientFields(data);

  // Re-key the object so the file always starts with $schema → version → app.
  const { $schema: _schema, version, ...rest } = cleaned;
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
 * Resolve the active app ID.
 *
 * Precedence: explicit flag → `.bunny/app.json` → legacy `app.id`
 * in `bunny.jsonc` (deprecation-warned). Throws if nothing resolves so
 * callers don't have to repeat the "no linked app" branch everywhere.
 */
export function resolveAppId(explicit?: string): string {
  if (explicit) return explicit;

  const manifest = loadManifest<AppManifest>(APP_MANIFEST);
  if (manifest.id) return manifest.id;

  if (configExists()) {
    const config = loadConfig();
    if (config.app.id) {
      logger.warn(
        `\`app.id\` in bunny.jsonc is deprecated and will be removed in a future release. Run \`bunny apps link ${config.app.id}\` to migrate to .bunny/${APP_MANIFEST}.`,
      );
      return config.app.id;
    }
  }

  throw new UserError(
    "No linked app.",
    "Run `bunny apps link <app-id>` to link this directory, or `bunny apps deploy` to create a new app.",
  );
}

/**
 * Resolve the registry record ID for a given container.
 *
 * Precedence: manifest entry → legacy `container.registry` in bunny.jsonc
 * (deprecation-warned). Returns undefined when neither source has it -
 * callers that need a registry should then prompt or otherwise resolve.
 */
export function resolveContainerRegistry(
  containerName: string,
  legacyContainer?: { registry?: string },
): string | undefined {
  const manifest = loadManifest<AppManifest>(APP_MANIFEST);
  const fromManifest = manifest.containers?.[containerName]?.registry;
  if (fromManifest) return fromManifest;

  if (legacyContainer?.registry) {
    logger.warn(
      `\`containers.${containerName}.registry\` in bunny.jsonc is deprecated. It will move to .bunny/${APP_MANIFEST} on the next deploy.`,
    );
    return legacyContainer.registry;
  }
  return undefined;
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
