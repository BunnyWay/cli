import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BunnyAppConfig, BunnyAppConfigSchema } from "@bunny.net/config";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import {
  CONFIG_FILENAME,
  configExists,
  configPath,
  readBunnyConfig,
} from "../../core/bunny-config.ts";
import { UserError } from "../../core/errors.ts";
import { syncJsonc } from "../../core/jsonc.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest } from "../../core/manifest.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

type Application = components["schemas"]["Application"];

// The `$schema` reference written into `bunny.jsonc`; resolves in a consumer's node_modules for editor validation.
const SCHEMA_REF = "./node_modules/@bunny.net/config/generated/schema.json";

// Re-export types and conversion functions for convenience
export type {
  BunnyAppConfig,
  ContainerConfig,
  RegionsConfig,
} from "@bunny.net/config";
export {
  apiToConfig,
  CURRENT_VERSION,
  configToAddRequest,
  configToPatchRequest,
  normalizeRegions,
  parseImageRef,
} from "@bunny.net/config";
// `bunny.jsonc` discovery lives in core so apps and sites share one walk-up.
export { configExists };

/**
 * Load and parse the app config.
 *
 * When `explicitPath` is given (e.g. from `--config <path>`), that file
 * is loaded verbatim. Otherwise we walk up from cwd looking for
 * `bunny.jsonc`. The `app` block is required here (see `BunnyAppConfigSchema`);
 * a sites-only file is read via `sites/config.ts` instead.
 */
export function loadConfig(explicitPath?: string): BunnyAppConfig {
  const found = readBunnyConfig(explicitPath);
  if (!found) {
    throw new UserError(
      `No config file found at ${configPath(explicitPath)}.`,
      "Run `bunny apps init` first, or pass --config <path>.",
    );
  }

  const { data, path } = found;
  if (data && typeof data === "object" && !("version" in data)) {
    throw new UserError(
      `${path} is missing the \`version\` field.`,
      "Run `bunny apps pull` to regenerate it from the remote app.",
    );
  }
  return BunnyAppConfigSchema.parse(data);
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
 *
 * An existing file is edited surgically (see {@link syncJsonc}), so comments,
 * key order, and any sibling blocks (such as `sites`) are preserved. A new
 * file is serialized fresh, starting with $schema → version → app.
 */
export function saveConfig(data: BunnyAppConfig, explicitPath?: string): void {
  const path = explicitPath ?? join(process.cwd(), CONFIG_FILENAME);
  const cleaned = stripTransientFields(data);

  // Re-key so a freshly written file starts with $schema → version → app.
  const { $schema: _schema, version, ...rest } = cleaned;
  const output = { $schema: SCHEMA_REF, version, ...rest };

  if (existsSync(path)) {
    writeFileSync(path, syncJsonc(readFileSync(path, "utf-8"), output));
  } else {
    writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
  }
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
