/**
 * Resolving a source's credentials from the environment and explicit values,
 * and validating the result against the plugin's own schema so the error names
 * the real constraint.
 */

import { UserError } from "@bunny.net/openapi-client";
import type { CredentialField, SourcePlugin } from "./contracts.ts";

export type Env = Record<string, string | undefined>;
export type SourceConfigValues = Record<string, string | number>;

function envValue(field: CredentialField, env: Env): string | undefined {
  for (const name of [field.env, ...(field.fallbackEnv ?? [])]) {
    const value = env[name];
    if (value) return value;
  }

  return undefined;
}

export function coerceCredential(
  field: CredentialField,
  value: string | number,
): string | number {
  if (field.type !== "number") return String(value);
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new UserError(`${field.label} must be a number, got "${value}".`);
  }

  return parsed;
}

export interface ResolveSourceConfigOptions {
  env?: Env;
  /** Per-field values from flags or prompts; they win over the environment. */
  overrides?: Record<string, string | number | undefined>;
  /**
   * Fill unset fields from the plugin's declared defaults. On by default,
   * because that is what building an adapter needs. Off answers "has the user
   * actually set anything?", which a defaulted field would otherwise mask.
   */
  includeDefaults?: boolean;
}

/** Every field a plugin declares, read from overrides then the environment, coerced to its declared type. */
export function resolveSourceConfig(
  plugin: SourcePlugin,
  options: ResolveSourceConfigOptions = {},
): SourceConfigValues {
  const { env = process.env, overrides = {}, includeDefaults = true } = options;
  const resolved: SourceConfigValues = {};

  for (const field of plugin.credentials) {
    const override = overrides[field.key];
    const value =
      override !== undefined && override !== ""
        ? override
        : envValue(field, env);

    if (value !== undefined && value !== "") {
      resolved[field.key] = coerceCredential(field, value);
    } else if (includeDefaults && field.default !== undefined) {
      resolved[field.key] = field.default;
    }
  }

  return resolved;
}

/** The credential fields the plugin's schema still rejects, in declaration order. */
export function missingCredentials(
  plugin: SourcePlugin,
  resolved: SourceConfigValues,
): CredentialField[] {
  const result = plugin.configSchema.safeParse(resolved);
  if (result.success) return [];
  const keys = new Set(result.error.issues.map((i) => String(i.path[0] ?? "")));

  return plugin.credentials.filter((field) => keys.has(field.key));
}

export type SourceReadiness = "ready" | "partial" | "unconfigured";

export interface SourceStatus {
  plugin: SourcePlugin;
  readiness: SourceReadiness;
  missing: CredentialField[];
}

/** How usable a source is from the environment alone. */
export function describeSource(plugin: SourcePlugin, env?: Env): SourceStatus {
  const explicit = resolveSourceConfig(plugin, { env, includeDefaults: false });
  const missing = missingCredentials(
    plugin,
    resolveSourceConfig(plugin, { env }),
  );
  const readiness: SourceReadiness =
    missing.length === 0
      ? "ready"
      : Object.keys(explicit).length > 0
        ? "partial"
        : "unconfigured";

  return { plugin, readiness, missing };
}

/** Validate a resolved config against the plugin's schema, naming missing fields by their environment variable. */
export function parseSourceConfig<C>(
  plugin: SourcePlugin<C>,
  resolved: SourceConfigValues,
): C {
  const result = plugin.configSchema.safeParse(resolved);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    const field = plugin.credentials.find((c) => c.key === key);

    return field ? `${field.label} (${field.env})` : key || issue.message;
  });

  throw new UserError(
    `${plugin.label} is not configured: ${[...new Set(problems)].join(", ")}.`,
    "Set the environment variables above, or run interactively to be prompted for them.",
  );
}
