import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
import type { StreamClient } from "@bunny.net/tools";
import type { StreamLibrary } from "@bunny.net/tools/stream";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import type { GlobalArgs, OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts } from "@/core/ui.ts";
import { requireSource, SOURCES } from "./import-sources.ts";

export interface ImportTarget {
  library: StreamLibrary;
  libraryId: number;
  accountId: string;
  /** Authenticated with the library's own key, ready for the engine. */
  stream: StreamClient;
}

/** Resolve the destination library (flag, linked directory, or picker); `offerLink: false` keeps a dry run from writing the link. */
export async function connectImportTarget(
  args: { library?: string } & Pick<
    GlobalArgs,
    "profile" | "apiKey" | "output" | "verbose"
  >,
  opts: { offerLink: boolean },
): Promise<ImportTarget> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const ctx = toolContext(config, { verbose: args.verbose });
  const { library, accountId, client } = await resolveLibraryInteractive(
    ctx,
    args.library,
    { output: args.output, offerLink: opts.offerLink },
  );

  return { library, libraryId: library.id, accountId, stream: client };
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

// `--source` wins, then the only source whose credentials are all in the environment, then a picker.
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

/** Credentials from flags then the environment; when some are missing interactively, prompts only for required fields nobody set. */
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

  const explicit = resolveSourceConfig(plugin, {
    overrides,
    includeDefaults: false,
  });
  const toPrompt = plugin.credentials.filter(
    (f) => f.required && explicit[f.key] === undefined,
  );
  // What is left is a bad combination of set values, which a prompt cannot fix.
  if (toPrompt.length === 0) return parseSourceConfig(plugin, resolved);

  logger.log(bunny.bold(`${plugin.label} credentials`));
  const entered: SourceConfigValues = {};
  for (const field of toPrompt) {
    entered[field.key] = await promptCredential(field);
  }
  const required = plugin.credentials.filter((f) => f.required);
  logger.dim(
    `Set ${required.map((f) => f.env).join(", ")} to skip these prompts next time.`,
  );

  return parseSourceConfig(
    plugin,
    resolveSourceConfig(plugin, { overrides: { ...overrides, ...entered } }),
  );
}

async function promptCredential(field: CredentialField): Promise<string> {
  if (field.hint) logger.dim(`  ${field.hint}`);
  const { value } = await prompts({
    type: field.secret ? "password" : "text",
    name: "value",
    message: `${field.label}:`,
    initial:
      field.secret || field.default === undefined
        ? undefined
        : String(field.default),
  });
  if (value === undefined) throw new UserError("Cancelled.");
  const trimmed = String(value).trim();
  if (trimmed) return trimmed;
  if (field.default !== undefined) return String(field.default);
  throw new UserError(`${field.label} is required.`);
}
