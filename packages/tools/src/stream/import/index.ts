import { existsSync } from "node:fs";
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
import {
  engineLogger,
  type ImportSession,
  type OpenedImport,
  openImport,
  seconds,
} from "./session.ts";
import {
  AMBIENT_CREDENTIAL_ENV,
  requireSource,
  SOURCE_IDS,
  SOURCES,
} from "./sources.ts";
import {
  findSavedImportSource,
  importStatePath,
  SavedImportError,
} from "./state.ts";

export * from "./model.ts";
export { findSource, requireSource, SOURCE_IDS, SOURCES } from "./sources.ts";
export {
  findSavedImportSource,
  importStatePath,
  SavedImportError,
  StateHomeError,
} from "./state.ts";

export const DEFAULT_PLAN_LIMIT = 100;
export const MAX_PLAN_LIMIT = 10_000;

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
        const missing = status.missing.map((f) => f.env);
        const ambient = AMBIENT_CREDENTIAL_ENV[plugin.id] ?? [];
        const needsKeys =
          !ctx.allowAmbientCredentials && ambient.every((env) => !ctx.env[env]);
        if (!needsKeys)
          return { ...base, readiness: status.readiness, missing, error: null };
        return {
          ...base,
          readiness:
            status.readiness === "ready" ? "partial" : status.readiness,
          missing: [...missing, ...ambient.filter((e) => !missing.includes(e))],
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
  schema: z.strictObject({
    ...target,
    limit: z
      .number()
      .int()
      .min(0)
      .max(MAX_PLAN_LIMIT)
      .optional()
      .describe(
        `Most video names to return in each summary list (default ${DEFAULT_PLAN_LIMIT}); counts always cover every video.`,
      ),
  }),
  kind: "read",
  localFiles: true,
  resultSchema: ImportPlanSchema,
  examples: [[{ library: "12345", source: "vimeo" }, "Plan a Vimeo import"]],
  run: async (ctx, input): Promise<ImportPlan> => {
    const session = await openImport(ctx, input);
    ctx.progress(`Discovering ${session.plugin.label} content...`);
    const summary = await session.service.getSummary(session.folder);
    const limit = input.limit ?? DEFAULT_PLAN_LIMIT;
    const lists = [
      summary.newVideosList,
      summary.migratedVideosList,
      summary.processingList,
    ];
    return {
      library: session.library,
      source: session.plugin.id,
      folder: session.folder ?? null,
      folderFromSavedRun: session.folderFromSavedRun,
      truncated: lists.some((list) => list.length > limit),
      summary: {
        ...summary,
        newVideosList: summary.newVideosList.slice(0, limit),
        migratedVideosList: summary.migratedVideosList.slice(0, limit),
        processingList: summary.processingList.slice(0, limit),
      },
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
    "Hand every not-yet-imported video from a source to a Stream library, tag it so a re-run skips it, and return once all are queued; Bunny then fetches and encodes them. Discovers the source afresh, so it may differ from an earlier plan. Resumable and idempotent; an aborted call returns with status `paused`. Progress is journaled locally; poll `stream.import.status` rather than setting `wait`.",
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
    expectedCount: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "The plan's `newVideos` a user confirmed; a whole-source run (no `folder`, no `resume`) that fetches a different number adds a warning.",
      ),
  }),
  kind: "write",
  localFiles: true,
  resultSchema: ImportRunSchema,
  examples: [[{ library: "12345", source: "vimeo" }, "Import from Vimeo"]],
  run: async (ctx, input): Promise<ImportRun> => {
    const processingTimeoutMs = seconds(
      input.processingTimeout,
      DEFAULT_PROCESSING_TIMEOUT,
    );
    const videoTimeoutMs = seconds(
      input.videoTimeout,
      DEFAULT_MIGRATION_TIMEOUT,
    );
    const startedAt = Date.now();
    const opened: OpenedImport = {};
    let session: ImportSession;
    let state: MigrationState;
    let queued = 0;
    // Entries with no Bunny video when queuing began: what a plan's `newVideos` counts, unlike re-tags and adopted orphans.
    let fetched = 0;
    try {
      session = await openImport(ctx, input, { processingTimeoutMs, opened });
      state = await session.service.runMigration({
        folderId: session.folder,
        concurrency: input.concurrency ?? DEFAULT_CONCURRENCY,
        resume: input.resume,
        wait: input.wait,
        // With `wait` the per-video timer also covers the encode, so it never undercuts the processing timeout.
        migrationTimeoutMs: input.wait
          ? Math.max(videoTimeoutMs, processingTimeoutMs)
          : videoTimeoutMs,
        signal: ctx.signal,
        onProgress: (s, phase, progress) => {
          if (phase === "wait") return ctx.progress(waitText(s));
          if (!progress) return;
          if (progress.done === 0)
            fetched = s.videoMigrations.filter(
              (m) =>
                !m.bunnyVideoId &&
                (m.status === "pending" || m.status === "fetching"),
            ).length;
          queued = progress.total;
          ctx.progress(
            `Handing videos to Bunny: ${progress.done}/${progress.total}`,
          );
        },
      });
    } catch (error) {
      // An abort that lands in a lookup surfaces as an error; it is still a pause, so every host can offer a resume.
      if (!ctx.signal?.aborted) throw error;
      const { library = null, statePath } = opened;
      return {
        library,
        source: input.source,
        folder: input.folder ?? null,
        dryRun: false,
        status: "paused",
        waited: Boolean(input.wait),
        queued,
        completed: 0,
        processing: 0,
        failed: [],
        collections: [],
        warnings: [],
        statePath: statePath && existsSync(statePath) ? statePath : null,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const by = (status: string) =>
      state.videoMigrations.filter((m) => m.status === status);
    const { warnings } = session.sink;
    // A folder or a resume can queue journal entries the plan never counted, so only a fresh whole-source run is compared.
    if (
      input.expectedCount !== undefined &&
      !session.folder &&
      !input.resume &&
      state.status !== "paused" &&
      fetched !== input.expectedCount
    ) {
      warnings.push(
        `The source changed after the plan: ${input.expectedCount} videos were confirmed, ${fetched} were queued.`,
      );
    }
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
      warnings,
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
    // Checked before locking, so a library with no import gets no state directory or lock file.
    const found = readMigrationState(statePath);
    if (!found) {
      throw new SavedImportError(
        `No ${plugin.label} import found for library ${lib.name}.`,
        "Run an import with this `library` and `source` first.",
        lib.id,
        [],
        plugin.id,
      );
    }
    // Held across the re-read and the refresh so a run that starts and finishes meanwhile is not overwritten with older state.
    const lock = acquireStateLock(statePath);
    try {
      const saved = readMigrationState(statePath) ?? found;

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
