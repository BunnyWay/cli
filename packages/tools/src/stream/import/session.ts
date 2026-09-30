import { UserError } from "@bunny.net/openapi-client";
import {
  assertFolderSupported,
  BunnyStream,
  createFileStateStore,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  type Logger,
  MigrationService,
  parseSourceConfig,
  readMigrationState,
  resolveSourceConfig,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import type { ToolContext } from "../../context.ts";
import { openStreamLibrary } from "../connect.ts";
import type { StreamLibrary } from "../model.ts";
import { requireSource } from "./sources.ts";
import { importStatePath } from "./state.ts";

/** What identifies one import: the same target in a plan and a run shares discovery. */
export interface ImportTarget {
  library: string;
  source: string;
  folder?: string;
  resume?: boolean;
  bucket?: string;
  prefix?: string;
  urlTtl?: number;
  requestTimeout?: number;
}

/** Where engine output goes for one tool call, plus the warnings it collects for the result. */
export interface EngineSink {
  ctx: ToolContext;
  warnings: string[];
}

export interface ImportSession {
  plugin: SourcePlugin;
  library: StreamLibrary;
  accountId: string;
  statePath: string;
  folder: string | undefined;
  folderFromSavedRun: boolean;
  service: MigrationService;
  sink: EngineSink;
}

/** What {@link openImport} resolved before it returned or failed. */
export type OpenedImport = Partial<
  Pick<ImportSession, "library" | "statePath">
>;

/** Engine lines become progress (and debug traces); `collect` keeps the run's warnings for the result. */
export function engineLogger(sink: EngineSink, collect = false): Logger {
  const note = (msg?: string) => {
    if (!msg) return;
    sink.ctx.progress(msg);
    sink.ctx.debug(msg);
  };
  return {
    log: note,
    info: note,
    success: note,
    dim: note,
    warn: (msg) => {
      note(msg);
      if (collect && !sink.warnings.includes(msg)) sink.warnings.push(msg);
    },
    // Per-video failures are in the result; the line itself is a trace.
    error: (msg) => sink.ctx.debug(msg),
    debug: (msg) => sink.ctx.debug(msg),
  };
}

export function seconds(value: number | undefined, fallbackMs: number): number {
  return value === undefined ? fallbackMs : value * 1000;
}

function sourceOverrides(target: ImportTarget) {
  return {
    bucket: target.bucket,
    prefix: target.prefix,
    presignedUrlTtl: target.urlTtl,
  };
}

// The engine words these for a terminal; a tool names its input fields and its env instead.
function hostNeutral<T>(fn: () => T, hint: string, message?: string): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    throw new UserError(message ?? error.message, hint);
  }
}

/** Resolve the library, source config, and scope, then build the engine; every call opens fresh so no state is shared between tool calls. */
export async function openImport(
  ctx: ToolContext,
  target: ImportTarget,
  opts: {
    processingTimeoutMs?: number;
    /** Filled as each step resolves, so a caller that is aborted midway knows how far it got. */
    opened?: OpenedImport;
  } = {},
): Promise<ImportSession> {
  const processingTimeoutMs =
    opts.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT;
  const plugin = requireSource(target.source);
  // Credentials come from the host env, never from input, so they stay out of any model's context.
  const resolved = resolveSourceConfig(plugin, {
    env: ctx.env,
    overrides: sourceOverrides(target),
  });

  ctx.progress("Resolving video library...");
  const { library, accountId, client } = await openStreamLibrary(
    ctx,
    target.library,
  );
  if (opts.opened) opts.opened.library = library;
  const statePath = importStatePath(plugin.id, library.id, accountId, ctx.env);
  if (opts.opened) opts.opened.statePath = statePath;
  // A resume without a folder keeps the saved scope; rediscovering the whole source would append every other folder to the run.
  const savedFolder = target.resume
    ? (readMigrationState(statePath)?.sourceFolderId ?? undefined)
    : undefined;
  const folder = target.folder ?? savedFolder;
  hostNeutral(
    () => assertFolderSupported(plugin, folder),
    "Omit `folder` to import everything.",
    `${plugin.label} has no folders, so \`folder\` cannot be used.`,
  );

  const config = hostNeutral(
    () => parseSourceConfig(plugin, resolved),
    "Set the environment variables above in the tool context's env.",
  );
  const requestTimeout = seconds(
    target.requestTimeout,
    DEFAULT_REQUEST_TIMEOUT,
  );
  const sink: EngineSink = { ctx, warnings: [] };
  const logger = engineLogger(sink);
  const adapter = plugin.createAdapter(config, {
    userAgent: ctx.userAgent,
    requestTimeout,
    logger,
    allowAmbientCredentials: ctx.allowAmbientCredentials,
  });
  ctx.progress(`Checking ${plugin.label} credentials...`);
  await adapter.validateCredentials();

  const session: ImportSession = {
    plugin,
    library,
    accountId,
    statePath,
    folder,
    folderFromSavedRun: !target.folder && folder !== undefined,
    sink,
    service: new MigrationService({
      adapter,
      bunny: new BunnyStream({
        client,
        libraryId: library.id,
        requestTimeout,
        processingTimeout: processingTimeoutMs,
        logger,
      }),
      store: createFileStateStore(statePath, {
        onWarn: (message) => engineLogger(sink, true).warn(message),
      }),
      logger: engineLogger(sink, true),
      libraryId: String(library.id),
      accountId,
      label: plugin.label,
    }),
  };
  return session;
}
