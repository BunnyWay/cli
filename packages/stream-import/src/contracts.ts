/**
 * The contracts every source adapter implements and the engine consumes.
 *
 * This module has no runtime dependencies, so an adapter can depend on it
 * without pulling in the engine or any API client.
 */

import type { ZodType } from "zod";

// ── Logging ──────────────────────────────────────────────────────────

/**
 * The logging surface the engine and adapters are allowed to use. The host
 * supplies the implementation; tests and library consumers can pass a no-op.
 *
 * Only `log` is meant for stdout. Everything else is progress and diagnostics
 * that a host should keep off any machine-readable output.
 */
export interface Logger {
  log(msg?: string): void;
  debug(msg: string): void;
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  dim(msg: string): void;
}

// ── Source content ───────────────────────────────────────────────────

export interface SourceFolder {
  id: string;
  name: string;
  /** Number of videos the source reports for this folder. */
  videoCount: number;
}

export interface SourceVideo {
  /** Stable dedup identifier, unique within the source (S3 uses `bucket/key`). */
  sourceId: string;
  displayName: string;
  folderId: string | null;
  /** Size in bytes. Undefined when the source does not report one. */
  size?: number;
  /** Duration in seconds. Undefined when the source does not report one. */
  duration?: number;
}

export interface SourceContent {
  folders: SourceFolder[];
  /** Keyed by `SourceFolder.id`. */
  videos: Map<string, SourceVideo[]>;
  uncategorizedVideos: SourceVideo[];
}

export interface DownloadInfo {
  /** A URL Bunny Stream can fetch directly. Must be HTTPS. */
  url: string;
  title: string;
  description?: string;
  tags?: string[];
  /** Extra headers Bunny should send when fetching `url`. */
  headers?: Record<string, string>;
}

// ── The adapter ──────────────────────────────────────────────────────

export interface SourceAdapter {
  /** Matches the owning plugin's `id`. */
  readonly id: string;
  /** The Bunny metaTag property used to dedup videos from this source. */
  readonly dedupTag: string;

  /** Throws `UserError` when the credentials are unusable. */
  validateCredentials(): Promise<void>;

  /** A short label/value map about the authenticated account. */
  getAccountInfo?(): Promise<Record<string, string>>;

  listContent(opts?: { folderId?: string }): Promise<SourceContent>;

  /**
   * Resolve a fetchable URL for one video. Returns `null` when the source has
   * no download available (wrong plan, still processing, deleted).
   */
  getDownloadInfo(
    sourceId: string,
    fallbackTitle?: string,
  ): Promise<DownloadInfo | null>;

  /**
   * Guard the URL before it is handed to Bunny. Overridden by sources with a
   * known host allowlist; `isHttpsUrl` is the default.
   */
  validateUrl?(url: string): boolean;
}

// ── The plugin descriptor ────────────────────────────────────────────

export interface CredentialField {
  /** Key within the plugin's config object. */
  key: string;
  /** Prompt label. */
  label: string;
  /** Environment variable that supplies this value. */
  env: string;
  /** Secrets are prompted for masked and never echoed. */
  secret: boolean;
  required: boolean;
  /** Extra env vars checked, in order, after `env`. */
  fallbackEnv?: string[];
  /** Shown under the prompt. */
  hint?: string;
  default?: string | number;
  type?: "string" | "number";
}

/**
 * Everything a host needs to know about a source platform. A source module
 * exports one of these; the host's only per-source knowledge is importing it.
 */
export interface SourcePlugin<C = any> {
  /** Stable identifier used by `--source`. */
  id: string;
  /** Human-readable name, e.g. "Cloudflare Stream". */
  label: string;
  dedupTag: string;
  /**
   * Whether the source has a folder concept that maps to Bunny collections.
   * When false a host should reject a folder filter instead of silently doing nothing.
   */
  supportsFolders: boolean;
  credentials: CredentialField[];
  configSchema: ZodType<C>;
  createAdapter(config: C, ctx: SourceContext): SourceAdapter;
}

/** Injected into every adapter: the values that would otherwise be host globals. */
export interface SourceContext {
  userAgent: string;
  requestTimeout: number;
  logger: Logger;
}

// ── Migration state ──────────────────────────────────────────────────

export type VideoMigrationStatus =
  | "pending"
  | "fetching"
  | "processing"
  | "completed"
  | "failed";

export type MigrationStatus = "in_progress" | "completed" | "failed" | "paused";

export interface FolderMapping {
  sourceFolderId: string;
  sourceFolderName: string;
  bunnyCollectionId: string;
  bunnyCollectionName: string;
}

export interface VideoMigration {
  sourceVideoId: string;
  videoName: string;
  sourceFolderId: string | null;
  bunnyVideoId: string | null;
  bunnyCollectionId: string | null;
  status: VideoMigrationStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  encodeProgress: number;
  /** Captured at fetch time so a resumed entry re-tags with the same metadata. */
  description?: string;
  tags?: string[];
}

export interface MigrationState {
  id: string;
  startedAt: string;
  updatedAt: string;
  source: string;
  bunnyLibraryId: string;
  /** Library IDs are account-scoped, so a resume also checks the account the run was started under. */
  bunnyAccountId?: string;
  /** The `--folder` the run was scoped to, so a resume defaults to the same scope. */
  sourceFolderId?: string | null;
  folderMappings: FolderMapping[];
  videoMigrations: VideoMigration[];
  status: MigrationStatus;
}

/**
 * State persistence, injected into `MigrationService` so the engine is
 * usable as a library and testable without touching the filesystem.
 */
export interface StateStore {
  load(): MigrationState | null;
  save(state: MigrationState): void;
  clear(): void;
}
