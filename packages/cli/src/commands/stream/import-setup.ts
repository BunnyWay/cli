import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
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
import {
  fetchAccountId,
  type VideoLibraryModel,
} from "@/commands/stream/api.ts";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import {
  connectStreamLibrary,
  type StreamClient,
} from "@/commands/stream/videos-api.ts";
import { type ResolvedConfig, resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { GlobalArgs, OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts } from "@/core/ui.ts";
import { requireSource, SOURCES } from "./import-sources.ts";

export interface ImportTarget {
  config: ResolvedConfig;
  library: VideoLibraryModel;
  libraryId: number;
  accountId: string;
  /** Authenticated with the library's own key, ready for the engine. */
  stream: StreamClient;
}

/** Resolve the destination library (flag, linked directory, or picker) and everything the import needs to talk to it. */
export async function connectImportTarget(
  args: { lib?: string } & Pick<
    GlobalArgs,
    "profile" | "apiKey" | "output" | "verbose"
  >,
): Promise<ImportTarget> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const coreClient = createCoreClient(clientOptions(config, args.verbose));
  const library = await resolveLibraryInteractive(coreClient, args.lib, {
    output: args.output,
    offerLink: true,
  });
  const libraryId = library.Id as number;
  const accountId = await fetchAccountId(coreClient);

  return {
    config,
    library,
    libraryId,
    accountId,
    stream: connectStreamLibrary(library, {
      config,
      verbose: args.verbose,
    }),
  };
}

/** The one source with a saved import for this library, when `--source` was left out. */
export function findSavedImportSource(
  libraryId: number,
  accountId: string,
): string {
  const dir = dirname(importStatePath("x", libraryId, accountId));
  const suffix = `-${libraryId}.json`;
  const sources = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, -suffix.length))
    : [];

  if (sources.length === 1 && sources[0]) return sources[0];
  throw new UserError(
    sources.length === 0
      ? `No saved import for library ${libraryId}.`
      : `Library ${libraryId} has imports from ${sources.join(", ")}.`,
    sources.length === 0
      ? "Start one with `bunny stream import`."
      : "Pass --source to pick one.",
  );
}

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
