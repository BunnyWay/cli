/**
 * The Bunny Stream surface the import engine needs, on top of a Stream client
 * the host has already authenticated with the library's own key.
 *
 * Everything here that is not request plumbing (the 429 retry, the collection
 * cache, the processing poll loop) is hand-written because none of it belongs
 * in a generated client.
 */

import {
  ApiError,
  type createStreamClient,
  UserError,
} from "@bunny.net/openapi-client";
import {
  type BunnyCollection,
  type BunnyMetaTag,
  type BunnyStatusModel,
  type BunnyVideo,
  BunnyVideoStatus,
} from "./bunny-types.ts";
import { MAX_RATE_LIMIT_RETRIES } from "./constants.ts";
import type { Logger } from "./contracts.ts";
import { createRateLimitMiddleware } from "./rate-limit.ts";
import { sleep } from "./time.ts";

export type StreamClient = ReturnType<typeof createStreamClient>;

const PAGE_SIZE = 100;
const PROCESSING_POLL_INTERVAL_MS = 5_000;
/** Consecutive failed polls tolerated while waiting, so one transient error does not fail an encode that is still running. */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/** `POST /videos/fetch` is documented as a bare `StatusModel`, but it also returns the GUID that dedup and tagging are keyed on. */
type FetchVideoResponse = BunnyStatusModel & { id?: string | null };

export interface BunnyStreamOptions {
  /** A Stream client authenticated with the library's own API key. */
  client: StreamClient;
  libraryId: number;
  requestTimeout: number;
  processingTimeout: number;
  logger: Logger;
  /** Injected by tests so a 429 back-off does not really wait. */
  retryWait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Delay between processing polls; injected by tests. */
  pollIntervalMs?: number;
}

export interface FetchVideoResult {
  success: boolean;
  videoId?: string;
  error?: string;
  /** The request may have reached Bunny (timeout, dropped connection, 5xx), so a video could exist that this call never saw. */
  indeterminate?: boolean;
}

export interface ProcessingResult {
  success: boolean;
  video?: BunnyVideo;
  error?: string;
}

// Duck-typed rather than `instanceof`, so a second copy of the client package still matches.
function apiErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ((error as { name?: string }).name !== "ApiError") return undefined;
  const status = (error as { status?: unknown }).status;

  return typeof status === "number" ? status : undefined;
}

function isApiErrorWithStatus(error: unknown, status: number): boolean {
  return apiErrorStatus(error) === status;
}

export class BunnyStream {
  private readonly stream: StreamClient;
  private readonly libraryId: number;
  private readonly processingTimeout: number;
  private readonly pollInterval: number;
  private readonly logger: Logger;

  /** Collections by lowercased name, so phase 2 lists them once rather than once per folder. */
  private collectionCache: Map<string, BunnyCollection> | null = null;

  constructor(options: BunnyStreamOptions) {
    const { client, libraryId, requestTimeout, processingTimeout, logger } =
      options;

    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      throw new UserError(
        `Invalid Bunny library ID: ${libraryId}`,
        "The library ID is the number shown next to your library in the Bunny dashboard.",
      );
    }

    this.libraryId = libraryId;
    this.processingTimeout = processingTimeout;
    this.pollInterval = options.pollIntervalMs ?? PROCESSING_POLL_INTERVAL_MS;
    this.logger = logger;
    this.stream = client;

    // Registered after the client's own auth middleware, so it sees a 429 first; it also owns the per-request deadline.
    this.stream.use(
      createRateLimitMiddleware({
        maxRetries: MAX_RATE_LIMIT_RETRIES,
        logger,
        requestTimeout,
        wait: options.retryWait,
      }),
    );
  }

  private get path() {
    return { libraryId: this.libraryId };
  }

  // ── Collections ────────────────────────────────────────────────────

  async listCollections(): Promise<BunnyCollection[]> {
    const collections: BunnyCollection[] = [];

    for (let page = 1; ; page++) {
      const { data } = await this.stream.GET(
        "/library/{libraryId}/collections",
        {
          params: { path: this.path, query: { page, itemsPerPage: PAGE_SIZE } },
        },
      );

      const items = data?.items ?? [];
      collections.push(...items);
      if (!hasMorePages(data, items.length, page)) break;
    }

    return collections;
  }

  async createCollection(name: string): Promise<BunnyCollection> {
    const { data } = await this.stream.POST(
      "/library/{libraryId}/collections",
      {
        params: { path: this.path },
        body: { name },
      },
    );

    if (!data?.guid) {
      throw new ApiError(
        `Bunny did not return a collection ID for "${name}".`,
        502,
      );
    }

    this.collectionCache?.set(name.toLowerCase(), data);

    return data;
  }

  /** Cached across the run: the set does not change underneath us apart from what we create. */
  async getOrCreateCollection(name: string): Promise<BunnyCollection> {
    if (!this.collectionCache) {
      const cache = new Map<string, BunnyCollection>();
      for (const collection of await this.listCollections()) {
        if (collection.name)
          cache.set(collection.name.toLowerCase(), collection);
      }
      this.collectionCache = cache;
    }

    const existing = this.collectionCache.get(name.toLowerCase());
    if (existing) {
      this.logger.debug(`Found existing collection: ${name}`);

      return existing;
    }

    this.logger.debug(`Creating new collection: ${name}`);

    return this.createCollection(name);
  }

  // ── Videos ─────────────────────────────────────────────────────────

  async listVideos(collectionId?: string): Promise<BunnyVideo[]> {
    const videos: BunnyVideo[] = [];

    for (let page = 1; ; page++) {
      const { data } = await this.stream.GET("/library/{libraryId}/videos", {
        params: {
          path: this.path,
          query: {
            page,
            itemsPerPage: PAGE_SIZE,
            ...(collectionId ? { collection: collectionId } : {}),
          },
        },
      });

      const items = data?.items ?? [];
      videos.push(...items);
      if (!hasMorePages(data, items.length, page)) break;
    }

    return videos;
  }

  /** Returns null for a video that no longer exists. */
  async getVideo(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<BunnyVideo | null> {
    try {
      const { data } = await this.stream.GET(
        "/library/{libraryId}/videos/{videoId}",
        {
          params: { path: { ...this.path, videoId } },
          signal,
        },
      );

      return data ?? null;
    } catch (error) {
      if (isApiErrorWithStatus(error, 404)) return null;
      throw error;
    }
  }

  async updateVideo(
    videoId: string,
    update: {
      title?: string;
      collectionId?: string;
      metaTags?: BunnyMetaTag[];
    },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.stream.POST("/library/{libraryId}/videos/{videoId}", {
      params: { path: { ...this.path, videoId } },
      body: update,
      signal,
    });
  }

  /** Ask Bunny to pull the video from `url`; errors are returned, not thrown, so one bad video fails only its own entry. */
  async fetchVideoFromUrl(
    request: { url: string; title?: string; headers?: Record<string, string> },
    collectionId?: string,
    signal?: AbortSignal,
  ): Promise<FetchVideoResult> {
    try {
      const { data } = await this.stream.POST(
        "/library/{libraryId}/videos/fetch",
        {
          params: {
            path: this.path,
            ...(collectionId ? { query: { collectionId } } : {}),
          },
          body: {
            url: request.url,
            ...(request.title ? { title: request.title } : {}),
            ...(request.headers ? { headers: request.headers } : {}),
          },
          signal,
        },
      );

      const body = data as FetchVideoResponse | undefined;

      if (body?.success === false) {
        return {
          success: false,
          error: body.message ?? "Bunny rejected the fetch request",
        };
      }

      // Bunny queued the video but did not say which one, so the next run matches it by title instead of fetching again.
      if (!body?.id) {
        return {
          success: false,
          error:
            "Bunny accepted the fetch but returned no video ID; the next run will match the video by title and tag it.",
          indeterminate: true,
        };
      }

      return { success: true, videoId: body.id };
    } catch (error) {
      const status = apiErrorStatus(error);
      const indeterminate = !(status !== undefined && status < 500);
      if (error instanceof Error)
        return { success: false, error: error.message, indeterminate };

      return { success: false, error: "Video fetch failed", indeterminate };
    }
  }

  /** Writes the dedup tag plus any description/keywords, in one update. */
  async setVideoMetadata(
    videoId: string,
    metadata: {
      description?: string;
      tags?: string[];
      sourceId?: string;
      sourceIdProperty?: string;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const metaTags: BunnyMetaTag[] = [];

    if (metadata.sourceId && metadata.sourceIdProperty) {
      metaTags.push({
        property: metadata.sourceIdProperty,
        value: metadata.sourceId,
      });
    }
    if (metadata.description) {
      metaTags.push({ property: "description", value: metadata.description });
    }
    if (metadata.tags?.length) {
      metaTags.push({ property: "keywords", value: metadata.tags.join(", ") });
    }

    if (metaTags.length > 0)
      await this.updateVideo(videoId, { metaTags }, signal);
  }

  /** Polls until the encoder finishes, errors, or the processing timeout hits. */
  async waitForVideoProcessing(
    videoId: string,
    onProgress?: (progress: number, status: number) => void,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<ProcessingResult> {
    const deadline = Date.now() + (timeoutMs ?? this.processingTimeout);
    let pollErrors = 0;

    while (Date.now() < deadline) {
      if (signal?.aborted) return { success: false, error: "Cancelled" };
      let video: BunnyVideo | null;
      try {
        video = await this.getVideo(videoId, signal);
      } catch (error) {
        if (signal?.aborted) return { success: false, error: "Cancelled" };
        if (++pollErrors > MAX_CONSECUTIVE_POLL_ERRORS) throw error;
        await sleep(this.pollInterval, signal);
        continue;
      }
      pollErrors = 0;
      if (!video) return { success: false, error: "Video not found" };

      onProgress?.(video.encodeProgress ?? 0, video.status);

      switch (video.status) {
        case BunnyVideoStatus.Finished:
          return { success: true, video };
        case BunnyVideoStatus.Error:
          return { success: false, error: "Video encoding failed", video };
        case BunnyVideoStatus.UploadFailed:
          return { success: false, error: "Video upload failed", video };
        default:
          await sleep(this.pollInterval, signal);
      }
    }

    return { success: false, error: "Processing timeout" };
  }
}

/** Stream pages carry no `hasMoreItems`, so termination comes from the counters, falling back to the page-size heuristic when they are missing. */
function hasMorePages(
  envelope:
    | { totalItems?: number; currentPage?: number; itemsPerPage?: number }
    | undefined,
  received: number,
  requestedPage: number,
): boolean {
  if (received === 0) return false;

  const total = envelope?.totalItems;
  const perPage = envelope?.itemsPerPage;
  const current = envelope?.currentPage;

  if (typeof total === "number" && typeof perPage === "number" && perPage > 0) {
    // Trust our own page counter when the server omits it, so a server that always echoes page 1 still terminates.
    const page =
      typeof current === "number" && current > 0 ? current : requestedPage;

    return page * perPage < total;
  }

  return received === PAGE_SIZE;
}
