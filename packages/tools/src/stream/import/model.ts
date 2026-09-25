import { z } from "zod";
import { StreamLibrarySchema } from "../model.ts";

export const SourceCredentialSchema = z.object({
  key: z.string(),
  label: z.string(),
  env: z.string(),
  fallbackEnv: z.array(z.string()),
  required: z.boolean(),
  secret: z.boolean(),
  hint: z.string().nullable(),
  default: z.union([z.string(), z.number()]).nullable(),
});

/** A source and whether the host environment configures it; names environment variables, never their values. */
export const ImportSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  supportsFolders: z.boolean(),
  credentials: z.array(SourceCredentialSchema),
  readiness: z.enum(["ready", "partial", "unconfigured", "invalid"]),
  /** Environment variables still needed, in declaration order. */
  missing: z.array(z.string()),
  /** Why a set value was rejected, when `readiness` is `invalid`. */
  error: z.string().nullable(),
});

export type ImportSource = z.infer<typeof ImportSourceSchema>;

const SummaryVideoSchema = z.object({
  name: z.string(),
  folder: z.string().nullable(),
});

/** The engine's discovery summary, key for key. */
export const ImportSummarySchema = z.object({
  totalFolders: z.number(),
  totalVideos: z.number(),
  alreadyMigrated: z.number(),
  processingOnBunny: z.number(),
  failedOnBunny: z.number(),
  newVideos: z.number(),
  totalSize: z.number(),
  totalDuration: z.number(),
  folders: z.array(z.object({ name: z.string(), videoCount: z.number() })),
  uncategorizedCount: z.number(),
  newVideosList: z.array(SummaryVideoSchema),
  migratedVideosList: z.array(SummaryVideoSchema),
  processingList: z.array(SummaryVideoSchema),
});

export const ImportPlanSchema = z.object({
  library: StreamLibrarySchema,
  source: z.string(),
  /** The folder scope, from input or, on a resume, from the saved run. */
  folder: z.string().nullable(),
  folderFromSavedRun: z.boolean(),
  /** True when a summary list was cut to the input `limit`; the counts are never cut. */
  truncated: z.boolean(),
  summary: ImportSummarySchema,
});

export type ImportPlan = z.infer<typeof ImportPlanSchema>;

export const ImportRunSchema = z.object({
  /** Null only when the call was aborted before the library was resolved. */
  library: StreamLibrarySchema.nullable(),
  source: z.string(),
  folder: z.string().nullable(),
  dryRun: z.literal(false),
  /** `paused` when the call was aborted; a resume continues it. */
  status: z.enum(["in_progress", "completed", "failed", "paused"]),
  waited: z.boolean(),
  /** Videos this run tried to hand to Bunny, including any that then failed. */
  queued: z.number(),
  completed: z.number(),
  processing: z.number(),
  failed: z.array(
    z.object({
      name: z.string(),
      sourceId: z.string(),
      error: z.string().nullable(),
    }),
  ),
  collections: z.array(
    z.object({
      sourceFolderId: z.string(),
      sourceFolderName: z.string(),
      bunnyCollectionId: z.string(),
      bunnyCollectionName: z.string(),
    }),
  ),
  /** Engine notices worth keeping, such as a resume that found nothing to resume. */
  warnings: z.array(z.string()),
  /** The local journal a resume or a status check reads; null when an aborted call never reached one. */
  statePath: z.string().nullable(),
  elapsedMs: z.number(),
});

export type ImportRun = z.infer<typeof ImportRunSchema>;

export const ImportStatusVideoSchema = z.object({
  name: z.string(),
  sourceId: z.string(),
  bunnyVideoId: z.string().nullable(),
  status: z.enum(["pending", "fetching", "processing", "completed", "failed"]),
  bunnyStatus: z.string(),
  stalled: z.boolean(),
  encodeProgress: z.number(),
  size: z.number(),
  queuedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const ImportStatusSchema = z.object({
  library: StreamLibrarySchema,
  source: z.string(),
  status: z.enum(["in_progress", "completed", "failed", "paused"]),
  completed: z.number(),
  processing: z.number(),
  failed: z.number(),
  stalled: z.number(),
  stalledAfterMinutes: z.number(),
  /** False while a run holds the state file; the refresh was then not written back. */
  saved: z.boolean(),
  videos: z.array(ImportStatusVideoSchema),
});

export type ImportStatus = z.infer<typeof ImportStatusSchema>;
