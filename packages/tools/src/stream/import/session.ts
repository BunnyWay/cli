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
import type { ToolClients, ToolContext } from "../../context.ts";
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

/** Where engine output goes; repointed at each tool call's context so a reused session reports to the current host. */
export interface EngineSink {
  ctx: ToolContext;
  warnings: string[];
}

export interface ImportSession {
  key: string;
  plannedAt: number;
  plugin: SourcePlugin;
  library: StreamLibrary;
  accountId: string;
  statePath: string;
  folder: string | undefined;
  folderFromSavedRun: boolean;
  service: MigrationService;
  sink: EngineSink;
}

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

// A plan leaves its session here so a run on the same context and target skips a second discovery walk.
const planned = new WeakMap<ToolClients, ImportSession>();
// A long-lived host may run hours after planning; past this the source is walked again so new videos are not missed.
const PLAN_REUSE_MS = 10 * 60_000;

function sessionKey(
  target: ImportTarget,
  config: Record<string, string | number>,
  processingTimeoutMs: number,
): string {
  return JSON.stringify([
    target.library,
    target.source,
    target.folder ?? null,
    Boolean(target.resume),
    seconds(target.requestTimeout, DEFAULT_REQUEST_TIMEOUT),
    processingTimeoutMs,
    config,
  ]);
}

function sourceOverrides(target: ImportTarget) {
  return {
    bucket: target.bucket,
    prefix: target.prefix,
    presignedUrlTtl: target.urlTtl,
  };
}

/** Resolve the library, source config, and scope, then build the engine; `keep` parks the session for a later run. */
export async function openImport(
  ctx: ToolContext,
  target: ImportTarget,
  opts: { processingTimeoutMs?: number; keep?: boolean } = {},
): Promise<ImportSession> {
  const processingTimeoutMs =
    opts.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT;
  const plugin = requireSource(target.source);
  // Credentials come from the host env, never from input, so they stay out of any model's context.
  const resolved = resolveSourceConfig(plugin, {
    env: ctx.env,
    overrides: sourceOverrides(target),
  });
  const key = sessionKey(target, resolved, processingTimeoutMs);

  const parked = planned.get(ctx.clients);
  planned.delete(ctx.clients);
  if (parked?.key === key && Date.now() - parked.plannedAt < PLAN_REUSE_MS) {
    parked.sink.ctx = ctx;
    parked.sink.warnings = [];
    if (opts.keep) planned.set(ctx.clients, parked);
    return parked;
  }

  ctx.progress("Resolving video library...");
  const { library, accountId, client } = await openStreamLibrary(
    ctx,
    target.library,
  );
  const statePath = importStatePath(plugin.id, library.id, accountId, ctx.env);
  // A resume without a folder keeps the saved scope; rediscovering the whole source would append every other folder to the run.
  const savedFolder = target.resume
    ? (readMigrationState(statePath)?.sourceFolderId ?? undefined)
    : undefined;
  const folder = target.folder ?? savedFolder;
  assertFolderSupported(plugin, folder);

  const config = parseSourceConfig(plugin, resolved);
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
  });
  ctx.progress(`Checking ${plugin.label} credentials...`);
  await adapter.validateCredentials();

  const session: ImportSession = {
    key,
    plannedAt: Date.now(),
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
  if (opts.keep) planned.set(ctx.clients, session);
  return session;
}
