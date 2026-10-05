import { homedir } from "node:os";
import { join } from "node:path";
import {
  type CredentialField,
  describeSource,
  type Env,
  type Logger as ImportLogger,
  missingCredentials,
  parseSourceConfig,
  resolveSourceConfig,
  type SourceConfigValues,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import { getImportCredentials } from "@/config/index.ts";
import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts } from "@/core/ui.ts";
import { requireSource, SOURCES } from "./import-sources.ts";

/** Saved import progress, one file per source and library, under the XDG state directory. */
export function importStatePath(source: string, libraryId: number): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");

  return join(base, "bunnynet", "stream-import", `${source}-${libraryId}.json`);
}

/** The engine's logger contract over the CLI logger: per-video lines only with --verbose, since the command renders progress and results itself. */
export function importLogger(verbose: boolean): ImportLogger {
  const debug = (msg: string) => logger.debug(msg, verbose);

  return {
    log: debug,
    info: debug,
    success: debug,
    warn: (msg) => logger.warn(msg),
    error: debug,
    dim: debug,
    debug,
  };
}

/** The environment with a profile's saved credentials filling whatever it leaves unset, and whether they filled anything. */
function credentialEnv(
  plugin: SourcePlugin,
  profile: string,
): { env: Env; fromSaved: boolean } {
  const env: Env = { ...process.env };
  const saved = getImportCredentials(profile, plugin.id) ?? {};
  let fromSaved = false;
  for (const field of plugin.credentials) {
    const value = saved[field.key];
    const names = [field.env, ...(field.fallbackEnv ?? [])];
    if (value === undefined || names.some((name) => env[name])) continue;
    env[field.env] = String(value);
    fromSaved = true;
  }

  return { env, fromSaved };
}

/**
 * Settle which platform the videos come from: `--source` wins, then the only
 * source whose credentials are all set (environment or saved), then a picker.
 */
export async function resolveImportSource(
  requested: string | undefined,
  profile: string,
  output: OutputFormat,
): Promise<SourcePlugin> {
  if (requested) return requireSource(requested);

  const statuses = SOURCES.map((plugin) =>
    describeSource(plugin, credentialEnv(plugin, profile).env),
  );
  const ready = statuses.filter((s) => s.readiness === "ready");
  if (ready.length === 1 && ready[0]) {
    logger.info(
      `Importing from ${ready[0].plugin.label}, the only source configured.`,
    );

    return ready[0].plugin;
  }

  if (!isInteractive(output)) {
    throw new UserError(
      "No source selected.",
      `Pass --source <${SOURCES.map((s) => s.id).join("|")}>.`,
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Where are the videos coming from?",
    choices: statuses.map((status) => ({
      title:
        status.readiness === "ready"
          ? `${status.plugin.label} (configured)`
          : status.plugin.label,
      value: status.plugin.id,
    })),
  });
  if (id === undefined) throw new UserError("A source is required.");

  return requireSource(id);
}

export interface SourceCredentials<C> {
  config: C;
  /** Values typed at the prompt this run, by field key; empty when nothing was asked. */
  entered: SourceConfigValues;
  /** Whether any value came from the profile's saved credentials. */
  fromSaved: boolean;
}

/**
 * Resolve a source's credentials from flags, the environment, then the
 * profile's saved values, prompting for whatever is still unset when the
 * terminal allows it. Unattended runs fail naming the environment variables.
 */
export async function resolveSourceCredentials<C>(
  plugin: SourcePlugin<C>,
  overrides: Record<string, string | number | undefined>,
  profile: string,
  output: OutputFormat,
): Promise<SourceCredentials<C>> {
  const { env, fromSaved } = credentialEnv(plugin, profile);
  const resolved = resolveSourceConfig(plugin, { env, overrides });
  if (
    missingCredentials(plugin, resolved).length === 0 ||
    !isInteractive(output)
  ) {
    return {
      config: parseSourceConfig(plugin, resolved),
      entered: {},
      fromSaved,
    };
  }

  logger.log(bunny.bold(`${plugin.label} credentials`));
  const entered: SourceConfigValues = {};
  for (const field of plugin.credentials) {
    if (resolved[field.key] !== undefined && field.default === undefined)
      continue;
    const value = await promptCredential(field, resolved[field.key]);
    if (value !== undefined) entered[field.key] = value;
  }

  return {
    config: parseSourceConfig(
      plugin,
      resolveSourceConfig(plugin, {
        env,
        overrides: { ...overrides, ...entered },
      }),
    ),
    entered,
    fromSaved,
  };
}

async function promptCredential(
  field: CredentialField,
  current: string | number | undefined,
): Promise<string | undefined> {
  if (field.hint) logger.dim(`  ${field.hint}`);
  const label = field.required ? field.label : `${field.label} (optional)`;
  const { value } = await prompts({
    type: field.secret ? "password" : "text",
    name: "value",
    message: `${label}:`,
    initial:
      field.secret || current === undefined ? undefined : String(current),
  });
  if (value === undefined) throw new UserError("Cancelled.");
  const trimmed = String(value).trim();
  if (!trimmed) {
    if (field.required && current === undefined)
      throw new UserError(`${field.label} is required.`);

    return undefined;
  }

  return trimmed;
}
