import { UserError } from "@bunny.net/openapi-client";
import {
  acquireStateLock,
  BunnyStream,
  createFileStateStore,
  DEFAULT_CONCURRENCY,
  DEFAULT_MIGRATION_TIMEOUT,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  DEFAULT_STALLED_AFTER_MS,
  describeSource,
  type MigrationState,
  readMigrationState,
  refreshMigrationState,
  videoStatusText,
} from "@bunny.net/stream-import";
import { z } from "zod";
import type { Tool } from "../../define-tool.ts";
import { defineTool } from "../../define-tool.ts";
import { openStreamLibrary } from "../connect.ts";
import {
  type ImportPlan,
  ImportPlanSchema,
  type ImportRun,
  ImportRunSchema,
  type ImportSource,
  ImportSourceSchema,
  type ImportStatus,
  ImportStatusSchema,
} from "./model.ts";
import { engineLogger, openImport, seconds } from "./session.ts";
import { requireSource, SOURCE_IDS, SOURCES } from "./sources.ts";
import { findSavedImportSource, importStatePath } from "./state.ts";

export * from "./model.ts";
export { findSource, requireSource, SOURCE_IDS, SOURCES } from "./sources.ts";
export { findSavedImportSource, importStatePath } from "./state.ts";

const library = z
  .string()
  .min(1)
  .describe("Destination video library ID, e.g. `12345`, or its exact name.");
const source = z
  .enum(SOURCE_IDS as [string, ...string[]])
  .describe(
    "Source platform. Its credentials are read from the host environment; see `stream.import.sources`.",
  );

// Only non-secret options: credentials never travel in input, where they would land in a model's context.
const target = {
  library,
  source,
  folder: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Import one source folder only (sources where `supportsFolders` is true).",
    ),
  resume: z
    .boolean()
    .optional()
    .describe(
      "Continue the saved import for this source and library; without `folder`, keeps the saved run's folder scope.",
    ),
  bucket: z
    .string()
    .min(1)
    .optional()
    .describe("S3 only: bucket, overriding S3_BUCKET."),
  prefix: z
    .string()
    .optional()
    .describe("S3 only: key prefix, overriding S3_PREFIX."),
  urlTtl: z
    .number()
    .int()
    .min(60)
    .max(604800)
    .optional()
    .describe("S3 only: pre-signed URL lifetime in seconds."),
  requestTimeout: z
    .number()
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe(
      `Seconds before one HTTP request gives up (default ${DEFAULT_REQUEST_TIMEOUT / 1000}).`,
    ),
};

export const streamImportSources = defineTool({
  name: "stream.import.sources",
  title: "List import sources",
  description:
    "List the platforms videos can be imported from, the environment variables each reads its credentials from, and whether the host environment configures it. Never returns credential values.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(ImportSourceSchema),
  run: async (ctx): Promise<ImportSource[]> =>
    SOURCES.map((plugin) => {
      const credentials = plugin.credentials.map((f) => ({
        key: f.key,
        label: f.label,
        env: f.env,
        fallbackEnv: f.fallbackEnv ?? [],
        required: f.required,
        secret: f.secret,
        hint: f.hint ?? null,
        default: f.default ?? null,
      }));
      const base = {
        id: plugin.id,
        label: plugin.label,
        supportsFolders: plugin.supportsFolders,
        credentials,
      };
      try {
        const status = describeSource(plugin, ctx.env);
        return {
          ...base,
          readiness: status.readiness,
          missing: status.missing.map((f) => f.env),
          error: null,
        };
      } catch (error) {
        // A set value that cannot be coerced, such as a non-numeric TTL.
        if (!(error instanceof UserError)) throw error;
        return {
          ...base,
          readiness: "invalid" as const,
          missing: [],
          error: error.message,
        };
      }
    }),
});

export const streamImportPlan = defineTool({
  name: "stream.import.plan",
  title: "Plan a video import",
  description:
    "Discover a source's videos and compare them with a Stream library: how many exist, how many are already imported or still processing, and which would be imported. Changes nothing and writes no state; fails naming the environment variables a source still needs.",
  schema: z.strictObject(target),
  kind: "read",
  localFiles: true,
  resultSchema: ImportPlanSchema,
  examples: [[{ library: "12345", source: "vimeo" }, "Plan a Vimeo import"]],
  run: async (ctx, input): Promise<ImportPlan> => {
    const session = await openImport(ctx, input, { keep: true });
    ctx.progress(`Discovering ${session.plugin.label} content...`);
    const summary = await session.service.getSummary(session.folder);
    return {
      library: session.library,
      source: session.plugin.id,
      folder: session.folder ?? null,
      folderFromSavedRun: session.folderFromSavedRun,
      summary,
    };
  },
});

function waitText(state: MigrationState): string {
  const tracked = state.videoMigrations.filter(
    (m) => m.bunnyVideoId && m.status !== "pending",
  );
  const finished = tracked.filter((m) => m.status === "completed").length;
  const failed = tracked.filter((m) => m.status === "failed").length;
  const average = tracked.length
    ? Math.round(
        tracked.reduce((sum, m) => sum + m.encodeProgress, 0) / tracked.length,
      )
    : 0;
  const tail = failed > 0 ? `, ${failed} failed` : "";

  return `Encoding: ${finished}/${tracked.length} finished, ${average}% average${tail}`;
}

export const streamImportRun = defineTool({
  name: "stream.import.run",
  title: "Import videos",
  description:
    "Hand every not-yet-imported video from a source to a Stream library, tag it so a re-run skips it, and return once all are queued; Bunny then fetches and encodes them. Resumable and idempotent. Progress is journaled locally; poll `stream.import.status` rather than setting `wait`.",
  schema: z.strictObject({
    ...target,
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        `Videos to hand to Bunny in parallel (default ${DEFAULT_CONCURRENCY}).`,
      ),
    videoTimeout: z
      .number()
      .int()
      .min(60)
      .max(86400)
      .optional()
      .describe(
        `Seconds before one video's hand-off, or its encode wait with \`wait\`, gives up (default ${DEFAULT_MIGRATION_TIMEOUT / 1000}).`,
      ),
    processingTimeout: z
      .number()
      .int()
      .min(60)
      .max(86400)
      .optional()
      .describe(
        `With \`wait\`: seconds to wait for Bunny to encode one video; raises \`videoTimeout\` when larger (default ${DEFAULT_PROCESSING_TIMEOUT / 1000}).`,
      ),
    wait: z
      .boolean()
      .optional()
      .describe(
        "Stay until Bunny has encoded every video, which can take hours. Hosts should leave this off and poll `stream.import.status`.",
      ),
  }),
  kind: "write",
  localFiles: true,
  resultSchema: ImportRunSchema,
  examples: [[{ library: "12345", source: "vimeo" }, "Import from Vimeo"]],
  // The engine takes no AbortSignal yet, so `ctx.signal` only cancels the library lookup.
  run: async (ctx, input): Promise<ImportRun> => {
    const processingTimeoutMs = seconds(
      input.processingTimeout,
      DEFAULT_PROCESSING_TIMEOUT,
    );
    const videoTimeoutMs = seconds(
      input.videoTimeout,
      DEFAULT_MIGRATION_TIMEOUT,
    );
    const session = await openImport(ctx, input, { processingTimeoutMs });
    const startedAt = Date.now();
    let queued = 0;
    const state = await session.service.runMigration({
      folderId: session.folder,
      concurrency: input.concurrency ?? DEFAULT_CONCURRENCY,
      resume: input.resume,
      wait: input.wait,
      // With `wait` the per-video timer also covers the encode, so it never undercuts the processing timeout.
      migrationTimeoutMs: input.wait
        ? Math.max(videoTimeoutMs, processingTimeoutMs)
        : videoTimeoutMs,
      onProgress: (s, phase, progress) => {
        if (phase === "wait") return ctx.progress(waitText(s));
        if (!progress) return;
        queued = progress.total;
        ctx.progress(
          `Handing videos to Bunny: ${progress.done}/${progress.total}`,
        );
      },
    });

    const by = (status: string) =>
      state.videoMigrations.filter((m) => m.status === status);
    return {
      library: session.library,
      source: session.plugin.id,
      folder: session.folder ?? null,
      dryRun: false,
      status: state.status,
      waited: Boolean(input.wait),
      queued,
      completed: by("completed").length,
      processing: by("processing").length,
      failed: by("failed").map((m) => ({
        name: m.videoName,
        sourceId: m.sourceVideoId,
        error: m.error,
      })),
      collections: state.folderMappings,
      warnings: session.sink.warnings,
      statePath: session.statePath,
      elapsedMs: Date.now() - startedAt,
    };
  },
});

export const streamImportStatus = defineTool({
  name: "stream.import.status",
  title: "Check an import",
  description:
    "Ask Bunny how far a saved import has got: each queued video's status, encode progress, and size, plus totals. Needs no source credentials. Reads the local journal a run wrote, and refreshes it unless a run is using it.",
  schema: z.strictObject({
    library,
    source: source
      .optional()
      .describe(
        "Source platform; defaults to the only one with a saved import for this library.",
      ),
  }),
  kind: "read",
  localFiles: true,
  resultSchema: ImportStatusSchema,
  examples: [[{ library: "12345" }, "Progress of the import into a library"]],
  run: async (ctx, input): Promise<ImportStatus> => {
    ctx.progress("Resolving video library...");
    const {
      library: lib,
      accountId,
      client,
    } = await openStreamLibrary(ctx, input.library);
    const plugin = requireSource(
      input.source ?? findSavedImportSource(lib.id, accountId, ctx.env),
    );
    const statePath = importStatePath(plugin.id, lib.id, accountId, ctx.env);
    // Held across the read and the refresh so a run that starts and finishes meanwhile is not overwritten with older state.
    const lock = acquireStateLock(statePath);
    try {
      const saved = readMigrationState(statePath);
      if (!saved) {
        throw new UserError(
          `No ${plugin.label} import found for library ${lib.name}.`,
          `Start one with \`bunny stream import --library ${lib.id} --source ${plugin.id}\`.`,
        );
      }

      const engine = new BunnyStream({
        client,
        libraryId: lib.id,
        requestTimeout: DEFAULT_REQUEST_TIMEOUT,
        processingTimeout: DEFAULT_PROCESSING_TIMEOUT,
        logger: engineLogger({ ctx, warnings: [] }),
      });
      ctx.progress("Checking with Bunny...");
      const { state, videos, stalled } = await refreshMigrationState(
        saved,
        engine,
      );
      // A live run owns the state file; its own saves will record what this refresh saw.
      if (lock) createFileStateStore(statePath).save(state);
      else
        ctx.debug(
          "An import is running for this library; not saving the refreshed state.",
        );

      const rows = state.videoMigrations.map((m) => {
        const video = m.bunnyVideoId ? videos.get(m.bunnyVideoId) : undefined;
        const isStalled = Boolean(
          m.bunnyVideoId && stalled.has(m.bunnyVideoId),
        );
        const label = video
          ? `${videoStatusText(video.status)}${isStalled ? " (stalled?)" : ""}`
          : m.status === "failed"
            ? "Failed"
            : m.status === "pending"
              ? "Not queued"
              : "Queued";

        return {
          name: m.videoName,
          sourceId: m.sourceVideoId,
          bunnyVideoId: m.bunnyVideoId,
          status: m.status,
          bunnyStatus: label,
          stalled: isStalled,
          encodeProgress: m.encodeProgress,
          size: video?.storageSize ?? 0,
          queuedAt: m.startedAt,
          error: m.error,
        };
      });
      const count = (status: string) =>
        rows.filter((r) => r.status === status).length;

      return {
        library: lib,
        source: plugin.id,
        status: state.status,
        completed: count("completed"),
        processing: count("processing"),
        failed: count("failed"),
        stalled: stalled.size,
        stalledAfterMinutes: DEFAULT_STALLED_AFTER_MS / 60_000,
        saved: lock !== null,
        videos: rows,
      };
    } finally {
      lock?.release();
    }
  },
});

export const streamImportTools: Tool[] = [
  streamImportSources,
  streamImportPlan,
  streamImportRun,
  streamImportStatus,
];
