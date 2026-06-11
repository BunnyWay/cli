import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type BunnyProjectConfig,
  BunnyProjectConfigSchema,
  CURRENT_VERSION,
  type DatabaseBinding,
  type ResourceKind,
  type ScriptBinding,
} from "@bunny.net/project-config";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { UserError } from "./errors.ts";
import { logger } from "./logger.ts";
import { confirm } from "./ui.ts";

export const PROJECT_CONFIG_FILENAME = "bunny.jsonc";

const SCHEMA_PATH =
  "./node_modules/@bunny.net/project-config/generated/schema.json";
const JSONC_FORMATTING = {
  formattingOptions: { insertSpaces: true, tabSize: 2 },
};

/** Walk up from cwd to the directory containing the project config, falling back to cwd. */
export function findProjectConfigRoot(): string {
  let dir = resolve(process.cwd());

  while (true) {
    if (existsSync(join(dir, PROJECT_CONFIG_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Resolve the project config path: explicit `--config` value or the nearest ancestor file. */
export function projectConfigPath(explicitPath?: string): string {
  return explicitPath ?? join(findProjectConfigRoot(), PROJECT_CONFIG_FILENAME);
}

/** Check whether a project config exists. */
export function projectConfigExists(explicitPath?: string): boolean {
  return existsSync(projectConfigPath(explicitPath));
}

/** Load and validate the project config, throwing a UserError with per-field issues when invalid. */
export function loadProjectConfig(explicitPath?: string): BunnyProjectConfig {
  const path = projectConfigPath(explicitPath);

  if (!existsSync(path)) {
    throw new UserError(
      `No project config found at ${path}.`,
      "Run `bunny project init` first, or pass --config <path>.",
    );
  }

  const raw = parseJsonc(readFileSync(path, "utf-8"));
  const result = BunnyProjectConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new UserError(`${path} is invalid:\n${issues}`);
  }
  return result.data;
}

/** Fresh config file content, commented to show where resource bindings go. */
export function projectConfigTemplate(name: string): string {
  return `{
  // Maps this project to the bunny.net resources it uses. Safe to commit.
  "$schema": "${SCHEMA_PATH}",
  "version": "${CURRENT_VERSION}",
  "name": ${JSON.stringify(name)},

  // Databases this project uses, keyed by binding name.
  // "db": { "id": "<database-id>", "name": "my-db" }
  "databases": {},

  // Edge Scripts this project uses, keyed by binding name.
  // "api": { "id": 123, "name": "my-api", "type": "standalone", "entry": "src/index.ts" }
  "scripts": {}
}
`;
}

/** Add project keys to an existing bunny.jsonc (e.g. an apps-only one) without touching the rest. */
export function augmentProjectConfig(name: string, path: string): void {
  const original = readFileSync(path, "utf-8");
  const existing = parseJsonc(original) ?? {};
  let text = original;

  // The project-config schema is the superset (it embeds the app block).
  text = applyEdits(
    text,
    modify(text, ["$schema"], SCHEMA_PATH, JSONC_FORMATTING),
  );
  if (existing.name === undefined) {
    text = applyEdits(text, modify(text, ["name"], name, JSONC_FORMATTING));
  }
  if (existing.databases === undefined) {
    text = applyEdits(text, modify(text, ["databases"], {}, JSONC_FORMATTING));
  }
  if (existing.scripts === undefined) {
    text = applyEdits(text, modify(text, ["scripts"], {}, JSONC_FORMATTING));
  }

  writeFileSync(path, text);
}

/** Add or replace a binding via a surgical JSONC edit so user comments survive. */
export function upsertBinding(
  kind: ResourceKind,
  binding: string,
  entry: DatabaseBinding | ScriptBinding,
  explicitPath?: string,
): string {
  const path = projectConfigPath(explicitPath);
  loadProjectConfig(explicitPath);

  const text = readFileSync(path, "utf-8");
  const edits = modify(text, [kind, binding], entry, JSONC_FORMATTING);
  writeFileSync(path, applyEdits(text, edits));
  return path;
}

/** Remove a binding via a surgical JSONC edit; returns the config path. */
export function removeBinding(
  kind: ResourceKind,
  binding: string,
  explicitPath?: string,
): string {
  const path = projectConfigPath(explicitPath);
  const text = readFileSync(path, "utf-8");
  const edits = modify(text, [kind, binding], undefined, JSONC_FORMATTING);
  writeFileSync(path, applyEdits(text, edits));
  return path;
}

/**
 * After a resource is created on bunny.net, offer to record it in the project
 * config. No-op unless a config exists and the session is interactive, so
 * `db create` / `scripts create` behave exactly as before for everyone else.
 */
export async function offerProjectRecord(opts: {
  kind: ResourceKind;
  binding: string;
  entry: DatabaseBinding | ScriptBinding;
  interactive: boolean;
}): Promise<boolean> {
  if (!opts.interactive || !projectConfigExists()) return false;

  let config: BunnyProjectConfig;
  try {
    config = loadProjectConfig();
  } catch {
    return false;
  }

  const bindings: Record<string, DatabaseBinding | ScriptBinding> =
    config[opts.kind] ?? {};
  if (Object.values(bindings).some((b) => b.id === opts.entry.id)) return false;

  let binding = opts.binding;
  for (let i = 2; binding in bindings; i++) binding = `${opts.binding}-${i}`;

  const shouldRecord = await confirm(
    `Add to ${PROJECT_CONFIG_FILENAME} as "${binding}"?`,
    { force: false },
  );
  if (!shouldRecord) return false;

  upsertBinding(opts.kind, binding, opts.entry);
  logger.success(
    `Recorded ${opts.kind}.${binding} in ${PROJECT_CONFIG_FILENAME}.`,
  );
  return true;
}
