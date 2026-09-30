/**
 * The import engine.
 *
 * Takes its state store and logger as constructor dependencies rather than
 * importing a host's, so it can be driven programmatically and tested without
 * touching the filesystem. It reports progress through the logger and returns
 * data; rendering a plan or a summary is the host's job.
 */

import type { BunnyStream } from "./bunny-stream.ts";
import type { BunnyVideo } from "./bunny-types.ts";
import { DEFAULT_CONCURRENCY, DEFAULT_MIGRATION_TIMEOUT } from "./constants.ts";
import type {
  Logger,
  MigrationState,
  SourceAdapter,
  SourceContent,
  SourceVideo,
  StateStore,
  VideoMigration,
} from "./contracts.ts";
import {
  isHttpsUrl,
  safeErrorMessage,
  sanitizeMetadata,
  stripAnsi,
} from "./sanitize.ts";
import { buildSourceIndex, videoHealth } from "./source-index.ts";
import { parseBunnyDate } from "./time.ts";

/** How long encode-progress updates accumulate before hitting disk; status transitions still write through immediately. */
const PROGRESS_SAVE_DEBOUNCE_MS = 2_000;

/** Slack between this machine's clock and Bunny's when matching a lost fetch by upload time. */
const CLOCK_SKEW_MS = 5 * 60_000;

export interface MigrationOptions {
  folderId?: string;
  concurrency?: number;
  resume?: boolean;
  /** Stay until Bunny has encoded every video. Off by default: queueing is the import, encoding is Bunny's job. */
  wait?: boolean;
  /** Ceiling for one unit of work on one video: the queue step, or the encode wait when `wait` is on. */
  migrationTimeoutMs?: number;
  /** Pauses the run: no new videos start, in-flight ones are abandoned for the next resume, and the state comes back `paused` instead of throwing. */
  signal?: AbortSignal;
  onProgress?: (
    state: MigrationState,
    phase: MigrationPhase,
    progress?: QueueProgress,
  ) => void;
}

export type MigrationPhase = "queue" | "wait";

/** Sent with every "queue" event: videos handed to Bunny (or failed) so far, out of those this run is queueing. */
export interface QueueProgress {
  done: number;
  total: number;
}

export interface SummaryVideo {
  name: string;
  folder: string | null;
}

export interface MigrationSummary {
  totalFolders: number;
  totalVideos: number;
  /** Tagged videos Bunny has finished encoding. */
  alreadyMigrated: number;
  /** Tagged videos Bunny is still fetching or encoding; left alone. */
  processingOnBunny: number;
  /** Tagged videos Bunny gave up on; counted in `newVideos` and imported again. */
  failedOnBunny: number;
  newVideos: number;
  /** Bytes across every discovered video, for sources that report size. */
  totalSize: number;
  totalDuration: number;
  folders: Array<{ name: string; videoCount: number }>;
  uncategorizedCount: number;
  newVideosList: SummaryVideo[];
  migratedVideosList: SummaryVideo[];
  processingList: SummaryVideo[];
}

export interface MigrationServiceOptions {
  adapter: SourceAdapter;
  bunny: BunnyStream;
  store: StateStore;
  logger: Logger;
  libraryId: string;
  /** Owner of the destination library; a saved run under another account is not resumed. */
  accountId?: string;
  /** Human-readable source name, from the plugin descriptor. */
  label?: string;
}

export class MigrationService {
  private readonly adapter: SourceAdapter;
  private readonly bunny: BunnyStream;
  private readonly store: StateStore;
  private readonly logger: Logger;
  private readonly libraryId: string;
  private readonly accountId: string | undefined;
  private readonly label: string;

  private state: MigrationState | null = null;
  private sourceIndex = new Map<string, BunnyVideo>();
  /** Every video GUID in the library, tagged or not, from the same listing that built the index. */
  private knownGuids = new Set<string>();
  /** Library videos without this source's dedup tag, the candidates for a fetch whose response was lost. */
  private untagged: BunnyVideo[] = [];

  /** Discovery result, cached so the run does not re-walk the source after the summary. */
  private discovery: {
    folderId: string | undefined;
    content: SourceContent;
  } | null = null;
  private indexLoaded = false;

  /** True only while `runMigration` holds the lock, so abandoned work can never write after it is released. */
  private active = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave = false;
  private notify: MigrationOptions["onProgress"];

  constructor(options: MigrationServiceOptions) {
    this.adapter = options.adapter;
    this.bunny = options.bunny;
    this.store = options.store;
    this.logger = options.logger;
    this.libraryId = options.libraryId;
    this.accountId = options.accountId;
    this.label = options.label ?? options.adapter.id;
  }

  // ── Discovery ──────────────────────────────────────────────────────

  private async discover(folderId?: string): Promise<SourceContent> {
    if (this.discovery && this.discovery.folderId === folderId) {
      return this.discovery.content;
    }
    const content = await this.adapter.listContent(
      folderId ? { folderId } : undefined,
    );
    this.discovery = { folderId, content };

    return content;
  }

  private async loadSourceIndex(): Promise<Map<string, BunnyVideo>> {
    if (this.indexLoaded) return this.sourceIndex;
    const bunnyVideos = await this.bunny.listVideos();
    this.sourceIndex = buildSourceIndex(bunnyVideos, this.adapter.dedupTag);
    this.knownGuids = new Set(
      bunnyVideos.flatMap((v) => (v.guid ? [v.guid] : [])),
    );
    this.untagged = bunnyVideos.filter(
      (v) => !v.metaTags?.some((t) => t.property === this.adapter.dedupTag),
    );
    this.indexLoaded = true;

    return this.sourceIndex;
  }

  async getSummary(folderId?: string): Promise<MigrationSummary> {
    const { folders, videos, uncategorizedVideos } =
      await this.discover(folderId);
    const index = await this.loadSourceIndex();

    const folderNames = new Map(folders.map((f) => [f.id, f.name]));
    const entries: Array<{ video: SourceVideo; folderName: string | null }> =
      [];

    for (const [fid, folderVideos] of videos) {
      for (const video of folderVideos) {
        entries.push({ video, folderName: folderNames.get(fid) ?? null });
      }
    }
    for (const video of uncategorizedVideos)
      entries.push({ video, folderName: null });

    const newVideosList: SummaryVideo[] = [];
    const migratedVideosList: SummaryVideo[] = [];
    const processingList: SummaryVideo[] = [];
    let failedOnBunny = 0;
    let totalSize = 0;
    let totalDuration = 0;

    for (const { video, folderName } of entries) {
      totalSize += video.size ?? 0;
      totalDuration += video.duration ?? 0;
      const row = { name: video.displayName, folder: folderName };
      const existing = index.get(video.sourceId);
      const health = existing ? videoHealth(existing) : undefined;
      if (health === "finished") migratedVideosList.push(row);
      else if (health === "processing") processingList.push(row);
      else {
        if (health === "failed") failedOnBunny++;
        newVideosList.push(row);
      }
    }

    return {
      totalFolders: folders.length,
      totalVideos: entries.length,
      alreadyMigrated: migratedVideosList.length,
      processingOnBunny: processingList.length,
      failedOnBunny,
      newVideos: newVideosList.length,
      totalSize,
      totalDuration,
      folders: folders.map((f) => ({ name: f.name, videoCount: f.videoCount })),
      uncategorizedCount: uncategorizedVideos.length,
      newVideosList,
      migratedVideosList,
      processingList,
    };
  }

  // ── The run ────────────────────────────────────────────────────────

  async runMigration(options: MigrationOptions = {}): Promise<MigrationState> {
    const { folderId, resume = false, wait = false, signal } = options;
    const concurrency = Math.max(
      1,
      Math.floor(positiveOr(options.concurrency, DEFAULT_CONCURRENCY)),
    );
    const timeout = positiveOr(
      options.migrationTimeoutMs,
      DEFAULT_MIGRATION_TIMEOUT,
    );

    const releaseLock = this.store.lock?.();
    this.active = true;
    this.state = null;
    // Read before anything flushes: a fresh run's first save replaces the journal that orphan recovery needs.
    const saved = this.store.load();
    const state = resume ? this.resumableState(saved) : this.newState();
    const resumed = state === saved;
    // Never narrow a resumed scope: a run over a different scope widens it to null, meaning the whole library or a mix.
    if (!resumed) state.sourceFolderId = folderId ?? null;
    else if ((state.sourceFolderId ?? null) !== (folderId ?? null))
      state.sourceFolderId = null;
    this.notify = options.onProgress;

    try {
      this.logger.info(`Discovering ${this.label} content`);
      const content = await this.discover(folderId);
      const { targetFolders, targetVideos, targetUncategorized } =
        scopeToFolder(content, folderId);

      const total = countVideos(targetVideos, targetUncategorized);
      this.logger.success(
        `Found ${targetFolders.length} folders and ${total} videos`,
      );

      this.logger.info("Checking for existing videos in Bunny...");
      const index = await this.loadSourceIndex();
      if (index.size > 0) {
        this.logger.info(`Found ${index.size} previously imported videos`);
      }

      if (signal?.aborted) {
        state.status = "paused";

        return state;
      }

      // A resumed journal can hold other folders' videos; only the confirmed scope is imported, while re-tagging a video already in Bunny is always allowed.
      const inScope = new Set(
        [...targetVideos.values(), targetUncategorized]
          .flat()
          .map((v) => v.sourceId),
      );
      const inFolder = (m: VideoMigration) =>
        !folderId || inScope.has(m.sourceVideoId);
      const scoped = (m: VideoMigration) =>
        inFolder(m) || Boolean(m.bunnyVideoId);

      if (resumed) {
        this.requeueFailed(state, inFolder);
        this.recoverLostFetches(state);
      } else this.adoptOrphans(state, saved);
      // Only now does the new state reach the store, so a failure above leaves the saved journal untouched.
      this.state = state;
      await this.createCollections(state, targetFolders);
      this.prepareEntries(state, targetVideos, targetUncategorized);
      this.reconcileWithBunny(state);

      // Phase 1: hand every video to Bunny and tag it. This is the import.
      const toQueue = state.videoMigrations.filter(
        (m) => scoped(m) && this.needsQueueing(m),
      );
      if (toQueue.length > 0) {
        this.logger.info(
          `Queueing ${toQueue.length} videos (concurrency: ${concurrency})`,
        );
        const progress = { done: 0, total: toQueue.length };
        options.onProgress?.(state, "queue", { ...progress });
        await runPool(
          toQueue,
          concurrency,
          async (migration) => {
            await this.withTimeout(
              migration,
              timeout,
              (perVideo) => this.queueVideo(migration, perVideo, signal),
              signal,
              false,
            );
            if (signal?.aborted) return;
            progress.done++;
            options.onProgress?.(state, "queue", { ...progress });
          },
          signal,
        );
      }

      // Phase 2, opt-in: stay until Bunny has encoded them.
      if (wait && !signal?.aborted) {
        const toAwait = state.videoMigrations.filter(
          (m) =>
            m.status === "processing" &&
            m.bunnyVideoId &&
            (inFolder(m) || m.sourceFolderId === folderId),
        );
        if (toAwait.length > 0) {
          this.logger.info(
            `Waiting for ${toAwait.length} videos to finish encoding`,
          );
          options.onProgress?.(state, "wait");
          await runPool(
            toAwait,
            concurrency,
            async (migration) => {
              await this.withTimeout(
                migration,
                timeout,
                (perVideo) => this.awaitVideo(migration, perVideo),
                signal,
              );
              options.onProgress?.(state, "wait");
            },
            signal,
          );
        }
      }

      // An entry the source no longer lists, in a scope this run discovered, can never progress; it is failed visibly so the run and `status` agree.
      for (const m of state.videoMigrations) {
        const gone =
          !inScope.has(m.sourceVideoId) &&
          !m.bunnyVideoId &&
          m.status !== "completed" &&
          (!folderId || m.sourceFolderId === folderId);
        if (!gone || signal?.aborted) continue;
        m.status = "failed";
        m.error = "No longer listed at the source";
      }
      state.status = signal?.aborted
        ? "paused"
        : overallStatus(state.videoMigrations);
      this.flush();

      return state;
    } catch (error) {
      if (this.state) {
        this.state.status = signal?.aborted ? "paused" : "failed";
        this.flush();
        if (signal?.aborted) return this.state;
      }
      throw error;
    } finally {
      this.cancelPendingSave();
      this.active = false;
      releaseLock?.();
    }
  }

  private newState(): MigrationState {
    return {
      id: `migration-${Date.now()}`,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: this.adapter.id,
      bunnyLibraryId: this.libraryId,
      bunnyAccountId: this.accountId,
      folderMappings: [],
      videoMigrations: [],
      status: "in_progress",
    };
  }

  /** Whether a saved run is about this source, library, and account. */
  private matchesRun(saved: MigrationState): string | null {
    if (
      saved.source !== this.adapter.id ||
      saved.bunnyLibraryId !== this.libraryId
    ) {
      return `Saved import is for ${saved.source} to library ${saved.bunnyLibraryId}.`;
    }
    // Only compared when both sides know the account, so a state file written by an older host still matches.
    if (
      saved.bunnyAccountId &&
      this.accountId &&
      saved.bunnyAccountId !== this.accountId
    ) {
      return "Saved import belongs to a different bunny.net account.";
    }

    return null;
  }

  /** A fresh run re-tags videos a dead run left in Bunny untagged, so a crash between fetch and tag never costs a duplicate. */
  private adoptOrphans(
    state: MigrationState,
    saved: MigrationState | null,
  ): void {
    if (!saved || this.matchesRun(saved)) return;
    const claimed = new Set(
      saved.videoMigrations.flatMap((m) =>
        m.bunnyVideoId ? [m.bunnyVideoId] : [],
      ),
    );
    const ambiguous = ambiguousTitles(saved.videoMigrations);

    // Deliberately not limited to the folder scope: re-tagging is a metadata write, and leaving an orphan out of the new journal loses it.
    for (const entry of saved.videoMigrations) {
      const guid =
        entry.bunnyVideoId ?? this.findLostFetch(entry, claimed, ambiguous);
      if (!guid) continue;
      // Tagged already, or replaced by a tagged copy: the index handles it. Gone from Bunny: fetch again.
      if (this.isTagged(guid) || this.sourceIndex.has(entry.sourceVideoId))
        continue;
      if (!this.knownGuids.has(guid)) continue;
      claimed.add(guid);

      const { pendingFetch: _, ...rest } = entry;
      state.videoMigrations.push({
        ...rest,
        bunnyVideoId: guid,
        status: "processing",
        error: null,
        completedAt: null,
      });
      this.logger.info(
        `Recovering: ${stripAnsi(entry.videoName)} (in Bunny, tag missing)`,
      );
    }
  }

  /** On resume, give entries whose fetch response was lost the video Bunny created for them, if it did. */
  private recoverLostFetches(state: MigrationState): void {
    const claimed = new Set(
      state.videoMigrations.flatMap((m) =>
        m.bunnyVideoId ? [m.bunnyVideoId] : [],
      ),
    );
    const ambiguous = ambiguousTitles(state.videoMigrations);
    for (const m of state.videoMigrations) {
      if (m.bunnyVideoId || !m.pendingFetch) continue;
      const guid = this.findLostFetch(m, claimed, ambiguous);
      m.pendingFetch = undefined;
      if (!guid) continue;
      claimed.add(guid);
      m.bunnyVideoId = guid;
      m.status = "processing";
      this.logger.info(
        `Recovering: ${stripAnsi(m.videoName)} (in Bunny, tag missing)`,
      );
    }
  }

  /** The one untagged library video matching a fetch whose outcome was never seen: same title, created no earlier than the request. */
  private findLostFetch(
    entry: VideoMigration,
    claimed: Set<string>,
    ambiguous: Set<string>,
  ): string | null {
    const pending = entry.pendingFetch;
    // Two lost fetches with one title cannot be told apart, so neither is matched and both fetch again.
    if (!pending || ambiguous.has(pending.title)) return null;
    const sentAt = Date.parse(pending.at) - CLOCK_SKEW_MS;
    const matches = this.untagged.filter(
      (v) =>
        v.guid &&
        !claimed.has(v.guid) &&
        v.title === pending.title &&
        parseBunnyDate(v.dateUploaded) >= sentAt,
    );

    return matches.length === 1 ? (matches[0]?.guid ?? null) : null;
  }

  /** Anything that is not already finished can be resumed, including runs marked `failed`. */
  private resumableState(existing: MigrationState | null): MigrationState {
    if (!existing) {
      this.logger.warn("No previous import to resume. Starting fresh.");

      return this.newState();
    }
    const mismatch = this.matchesRun(existing);
    if (mismatch) {
      this.logger.warn(`${mismatch} Starting fresh.`);

      return this.newState();
    }
    if (existing.status === "completed") {
      this.logger.warn("Previous import already completed. Starting fresh.");

      return this.newState();
    }

    this.logger.info("Resuming previous import...");
    existing.status = "in_progress";

    return existing;
  }

  /** A failed entry in this run's scope that already has a Bunny video resumes at tagging; one without starts over. */
  private requeueFailed(
    state: MigrationState,
    inScope: (m: VideoMigration) => boolean,
  ): void {
    const failed = state.videoMigrations.filter(
      (m) => m.status === "failed" && inScope(m),
    );
    if (failed.length === 0) return;
    for (const m of failed) {
      m.status = m.bunnyVideoId ? "processing" : "pending";
      m.error = null;
      m.completedAt = null;
    }
    this.logger.info(`Retrying ${failed.length} failed videos`);
  }

  private async createCollections(
    state: MigrationState,
    folders: SourceContent["folders"],
  ): Promise<void> {
    if (folders.length === 0) return;
    this.logger.info("Creating Bunny collections");

    for (const folder of folders) {
      if (state.folderMappings.some((m) => m.sourceFolderId === folder.id)) {
        this.logger.debug(`Collection already mapped: ${folder.name}`);
        continue;
      }

      const collection = await this.bunny.getOrCreateCollection(folder.name);
      state.folderMappings.push({
        sourceFolderId: folder.id,
        sourceFolderName: folder.name,
        bunnyCollectionId: collection.guid ?? "",
        bunnyCollectionName: collection.name ?? folder.name,
      });
      this.logger.success(`Collection ready: ${stripAnsi(folder.name)}`);
      this.flush();
    }
  }

  private prepareEntries(
    state: MigrationState,
    videos: Map<string, SourceVideo[]>,
    uncategorized: SourceVideo[],
  ): void {
    const known = new Set(state.videoMigrations.map((m) => m.sourceVideoId));

    const add = (
      video: SourceVideo,
      folderId: string | null,
      collectionId: string | null,
    ) => {
      if (known.has(video.sourceId)) return;
      known.add(video.sourceId);
      state.videoMigrations.push({
        sourceVideoId: video.sourceId,
        videoName: video.displayName,
        sourceFolderId: folderId,
        bunnyVideoId: null,
        bunnyCollectionId: collectionId,
        status: "pending",
        error: null,
        startedAt: null,
        completedAt: null,
        encodeProgress: 0,
      });
    };

    for (const [folderId, folderVideos] of videos) {
      const mapping = state.folderMappings.find(
        (m) => m.sourceFolderId === folderId,
      );
      for (const video of folderVideos) {
        add(video, folderId, mapping?.bunnyCollectionId ?? null);
      }
    }
    for (const video of uncategorized) add(video, null, null);

    this.flush();
  }

  /** Line every entry up with what Bunny already holds under its tag, so the queue only touches what Bunny lacks. */
  private reconcileWithBunny(state: MigrationState): void {
    for (const m of state.videoMigrations) {
      if (m.status === "completed") continue;
      const existing = this.sourceIndex.get(m.sourceVideoId);
      if (!existing?.guid) continue;
      switch (videoHealth(existing)) {
        case "finished":
          m.bunnyVideoId = existing.guid;
          m.status = "completed";
          m.completedAt ??= new Date().toISOString();
          m.encodeProgress = 100;
          this.logger.debug(`Already imported: ${stripAnsi(m.videoName)}`);
          break;
        case "processing":
          m.bunnyVideoId = existing.guid;
          m.status = "processing";
          m.encodeProgress = existing.encodeProgress ?? m.encodeProgress;
          this.logger.debug(
            `Still processing on Bunny: ${stripAnsi(m.videoName)}`,
          );
          break;
        case "failed":
          // The dead copy stays in the library; a fresh fetch gets a new video and the index will prefer it next time.
          m.bunnyVideoId = null;
          m.status = "pending";
          this.logger.warn(
            `Bunny could not import ${stripAnsi(m.videoName)} last time; importing again`,
          );
          break;
      }
    }
    this.flush();
  }

  /** Untouched entries, and entries whose Bunny video is not yet carrying the dedup tag. */
  private needsQueueing(m: VideoMigration): boolean {
    if (m.status === "pending" || m.status === "fetching") return true;
    if (m.status !== "processing" || !m.bunnyVideoId) return false;

    return !this.isTagged(m.bunnyVideoId);
  }

  private isTagged(guid: string): boolean {
    for (const video of this.sourceIndex.values()) {
      if (video.guid === guid) return true;
    }

    return false;
  }

  // ── One video ──────────────────────────────────────────────────────

  /** Race one unit of work against the timeout; the loser is aborted so it cannot rewrite the entry later. */
  private async withTimeout(
    migration: VideoMigration,
    timeoutMs: number,
    work: (signal: AbortSignal) => Promise<void>,
    runSignal?: AbortSignal,
    abandonOnPause = true,
  ): Promise<void> {
    if (runSignal?.aborted) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(`Import timeout after ${Math.round(timeoutMs / 1000)}s`),
        );
        controller.abort();
      }, timeoutMs);
    });
    // A pause abandons an encode wait, but lets a hand-off to Bunny settle so the journal records what Bunny created before the lock is released.
    let onPause = () => {};
    const paused = new Promise<void>((resolve) => {
      onPause = () => {
        controller.abort();
        resolve();
      };
    });
    if (abandonOnPause)
      runSignal?.addEventListener("abort", onPause, { once: true });

    try {
      await Promise.race([
        work(controller.signal),
        deadline,
        ...(abandonOnPause ? [paused] : []),
      ]);
    } catch (error) {
      if (abandonOnPause && runSignal?.aborted) return;
      // The work handles its own failures, so anything arriving here is the timeout or a genuine escape.
      migration.status = "failed";
      migration.error = safeErrorMessage(error, "Import failed");
      this.logger.error(
        `Failed: ${stripAnsi(migration.videoName)} - ${migration.error}`,
      );
      this.flush();
    } finally {
      if (timer) clearTimeout(timer);
      runSignal?.removeEventListener("abort", onPause);
    }
  }

  /** Fetch (unless Bunny already has the video) and tag. Leaves the entry at `processing`: Bunny's turn. */
  private async queueVideo(
    migration: VideoMigration,
    signal: AbortSignal,
    runSignal?: AbortSignal,
  ): Promise<void> {
    try {
      let videoId: string;
      if (migration.status === "processing" && migration.bunnyVideoId) {
        // Interrupted between fetch and tag last time; closing that window is all that is left.
        this.logger.debug(`Resuming: ${stripAnsi(migration.videoName)}`);
        videoId = migration.bunnyVideoId;
      } else {
        videoId = await this.startFetch(migration, signal, runSignal);
      }

      await this.tagVideo(migration, videoId, signal);
      if (signal.aborted) return;
      this.logger.debug(`Queued: ${stripAnsi(migration.videoName)}`);
    } catch (error) {
      if (signal.aborted) return;
      // Paused before anything reached Bunny: back to pending, untouched, for the next resume.
      if (
        runSignal?.aborted &&
        !migration.bunnyVideoId &&
        !migration.pendingFetch
      ) {
        migration.status = "pending";
        migration.startedAt = null;
        this.flush();
        return;
      }
      migration.status = "failed";
      migration.error = safeErrorMessage(error, "Import failed");
      this.logger.error(
        `Failed: ${stripAnsi(migration.videoName)} - ${migration.error}`,
      );
    }

    this.flush();
  }

  /** Poll Bunny until the video is encoded. Quiet on purpose: the host renders progress from `onProgress`. */
  private async awaitVideo(
    migration: VideoMigration,
    signal: AbortSignal,
  ): Promise<void> {
    const videoId = migration.bunnyVideoId;
    if (!videoId) return;
    try {
      const processed = await this.bunny.waitForVideoProcessing(
        videoId,
        (progress) => {
          if (signal.aborted) return;
          migration.encodeProgress = progress;
          this.scheduleSave();
          if (this.state) this.notify?.(this.state, "wait");
        },
        undefined,
        signal,
      );
      if (signal.aborted) return;

      if (!processed.success)
        throw new Error(processed.error ?? "Processing failed");

      migration.status = "completed";
      migration.encodeProgress = 100;
      migration.completedAt = new Date().toISOString();
      this.logger.debug(`Finished: ${stripAnsi(migration.videoName)}`);
    } catch (error) {
      if (signal.aborted) return;
      migration.status = "failed";
      migration.error = safeErrorMessage(error, "Import failed");
      this.logger.debug(
        `Failed: ${stripAnsi(migration.videoName)} - ${migration.error}`,
      );
    }

    this.flush();
  }

  private async startFetch(
    migration: VideoMigration,
    signal: AbortSignal,
    runSignal?: AbortSignal,
  ): Promise<string> {
    migration.status = "fetching";
    migration.startedAt = new Date().toISOString();
    migration.error = null;
    this.flush();

    // A pause cancels the source lookup; only a fetch already sent to Bunny is allowed to settle.
    const info = await this.adapter.getDownloadInfo(
      migration.sourceVideoId,
      runSignal ? AbortSignal.any([signal, runSignal]) : signal,
    );
    signal.throwIfAborted();
    runSignal?.throwIfAborted();
    if (!info)
      throw new Error(
        "No download available: the video was not found at the source or has no usable file",
      );
    const title = info.title || migration.videoName;

    if (info.description) migration.description = info.description;
    if (info.tags?.length) migration.tags = info.tags;

    const isValid =
      this.adapter.validateUrl?.(info.url) ?? isHttpsUrl(info.url);
    if (!isValid)
      throw new Error("Invalid URL: not an allowed host for this source");

    this.logger.debug(`Importing: ${stripAnsi(migration.videoName)}`);

    runSignal?.throwIfAborted();
    migration.pendingFetch = {
      title,
      at: new Date().toISOString(),
    };
    this.flush();
    const result = await this.bunny.fetchVideoFromUrl(
      { url: info.url, title, headers: info.headers },
      migration.bunnyCollectionId ?? undefined,
      signal,
    );
    if (!result.success || !result.videoId) {
      signal.throwIfAborted();
      if (!result.indeterminate) migration.pendingFetch = undefined;
      throw new Error(result.error ?? "Failed to initiate fetch");
    }

    // Saved before the abort check and the metaTag write, so a pause or resume can never lose a video Bunny created.
    migration.pendingFetch = undefined;
    migration.bunnyVideoId = result.videoId;
    migration.status = "processing";
    this.flush();
    signal.throwIfAborted();

    return result.videoId;
  }

  private async tagVideo(
    migration: VideoMigration,
    videoId: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.bunny.setVideoMetadata(
      videoId,
      {
        sourceId: migration.sourceVideoId,
        sourceIdProperty: this.adapter.dedupTag,
        ...this.discoveredMetadata(migration),
      },
      signal,
    );
  }

  /** Description and tags were saved on the entry at fetch time, so a resumed re-tag keeps them. */
  private discoveredMetadata(migration: VideoMigration): {
    description?: string;
    tags?: string[];
  } {
    const { description, tags } = migration;

    return description || tags ? sanitizeMetadata({ description, tags }) : {};
  }

  // ── State persistence ──────────────────────────────────────────────

  /** Write through immediately. Used for every status transition. */
  private flush(): void {
    if (!this.state || !this.active) return;
    this.cancelPendingSave();
    this.state.updatedAt = new Date().toISOString();
    this.store.save(this.state);
  }

  /** Coalesce high-frequency encode-progress updates. */
  private scheduleSave(): void {
    if (this.pendingSave) return;
    this.pendingSave = true;
    this.saveTimer = setTimeout(() => {
      this.pendingSave = false;
      this.saveTimer = null;
      if (this.state && this.active) {
        this.state.updatedAt = new Date().toISOString();
        this.store.save(this.state);
      }
    }, PROGRESS_SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  private cancelPendingSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pendingSave = false;
  }

  getState(): MigrationState | null {
    return this.state ?? this.store.load();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** A finite positive number, or the default: NaN, zero, and negatives from a host's flag parsing never reach the engine. */
function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** Titles shared by more than one unresolved lost fetch, computed once so resolving one entry cannot make its twin look unique. */
function ambiguousTitles(entries: VideoMigration[]): Set<string> {
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const m of entries) {
    if (m.bunnyVideoId || !m.pendingFetch) continue;
    const { title } = m.pendingFetch;
    if (seen.has(title)) ambiguous.add(title);
    seen.add(title);
  }

  return ambiguous;
}

function countVideos(
  videos: Map<string, SourceVideo[]>,
  uncategorized: SourceVideo[],
): number {
  let count = uncategorized.length;
  for (const list of videos.values()) count += list.length;

  return count;
}

function scopeToFolder(content: SourceContent, folderId: string | undefined) {
  if (!folderId) {
    return {
      targetFolders: content.folders,
      targetVideos: content.videos,
      targetUncategorized: content.uncategorizedVideos,
    };
  }

  return {
    targetFolders: content.folders.filter((f) => f.id === folderId),
    targetVideos: new Map(
      [...content.videos].filter(([id]) => id === folderId),
    ),
    targetUncategorized: [] as SourceVideo[],
  };
}

/** A worker pool, not a batch loop: no slot idles on the slowest video of a window. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;

  const runners = Array.from(
    {
      length: Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length)),
    },
    async () => {
      while (!signal?.aborted) {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index] as T);
      }
    },
  );

  await Promise.all(runners);
}

/** Failed anywhere wins; otherwise anything Bunny is still working on keeps the run open. */
function overallStatus(entries: VideoMigration[]): MigrationState["status"] {
  const statuses = entries.map((m) => m.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.some((s) => s !== "completed")) return "in_progress";

  return "completed";
}
