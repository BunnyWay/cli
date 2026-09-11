import { homedir } from "node:os";
import { join } from "node:path";
import {
  type CredentialField,
  describeSource,
  type Logger as ImportLogger,
  missingCredentials,
  parseSourceConfig,
  resolveSourceConfig,
  type SourceConfigValues,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts } from "@/core/ui.ts";
import { requireSource, SOURCES } from "./import-sources.ts";

/** Saved import progress under the XDG state directory: one file per account, source, and library, since library IDs repeat across accounts. */
export function importStatePath(
  source: string,
  libraryId: number,
  accountId: string,
): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");

  return join(
    base,
    "bunnynet",
    "stream-import",
    accountId,
    `${source}-${libraryId}.json`,
  );
}

/** The engine's logger contract over the CLI logger; `debug` closes over --verbose. */
export function importLogger(verbose: boolean): ImportLogger {
  return {
    log: (msg) => logger.log(msg),
    info: (msg) => logger.info(msg),
    success: (msg) => logger.success(msg),
    warn: (msg) => logger.warn(msg),
    error: (msg) => logger.error(msg),
    dim: (msg) => logger.dim(msg),
    debug: (msg) => logger.debug(msg, verbose),
  };
}

/**
 * Settle which platform the videos come from: `--source` wins, then the only
 * source whose credentials are all in the environment, then a picker.
 */
export async function resolveImportSource(
  requested: string | undefined,
  output: OutputFormat,
): Promise<SourcePlugin> {
  if (requested) return requireSource(requested);

  const statuses = SOURCES.map((plugin) => describeSource(plugin));
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

/**
 * Resolve a source's credentials from flags and the environment, prompting for
 * whatever is still unset when the terminal allows it. Unattended runs fail
 * naming the environment variables instead.
 */
export async function resolveSourceCredentials<C>(
  plugin: SourcePlugin<C>,
  overrides: Record<string, string | number | undefined>,
  output: OutputFormat,
): Promise<C> {
  const resolved = resolveSourceConfig(plugin, { overrides });
  if (
    missingCredentials(plugin, resolved).length === 0 ||
    !isInteractive(output)
  ) {
    return parseSourceConfig(plugin, resolved);
  }

  logger.log(bunny.bold(`${plugin.label} credentials`));
  const entered: SourceConfigValues = {};
  for (const field of plugin.credentials) {
    if (resolved[field.key] !== undefined && field.default === undefined)
      continue;
    const value = await promptCredential(field, resolved[field.key]);
    if (value !== undefined) entered[field.key] = value;
  }
  logger.dim(
    `Set ${plugin.credentials.map((f) => f.env).join(", ")} to skip these prompts next time.`,
  );

  return parseSourceConfig(
    plugin,
    resolveSourceConfig(plugin, { overrides: { ...overrides, ...entered } }),
  );
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
