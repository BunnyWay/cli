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

export type StreamClient = ReturnType<typeof createStreamClient>;

const PAGE_SIZE = 100;
const PROCESSING_POLL_INTERVAL_MS = 5_000;

/**
 * `POST /videos/fetch` is documented as returning a bare `StatusModel`, but the
 * GUID it also returns is what the entire dedup / metaTag / progress chain is
 * keyed on. If Bunny ever stops returning it, `fetchVideoFromUrl` fails loudly
 * instead of silently importing untagged videos.
 */
type FetchVideoResponse = BunnyStatusModel & { id?: string | null };

export interface BunnyStreamOptions {
  /** A Stream client authenticated with the library's own API key. */
  client: StreamClient;
  libraryId: number;
  requestTimeout: number;
  processingTimeout: number;
  logger: Logger;
  /** Injected by tests so a 429 back-off does not really wait. */
  retryWait?: (ms: number) => Promise<void>;
}

export interface FetchVideoResult {
  success: boolean;
  videoId?: string;
  error?: string;
}

export interface ProcessingResult {
  success: boolean;
  video?: BunnyVideo;
  error?: string;
}

// Duck-typed rather than `instanceof`, so a second copy of the client package still matches.
function isApiErrorWithStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ApiError" &&
    (error as { status?: number }).status === status
  );
}

export class BunnyStream {
  private readonly stream: StreamClient;
  private readonly libraryId: number;
  private readonly requestTimeout: number;
  private readonly processingTimeout: number;
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
    this.requestTimeout = requestTimeout;
    this.processingTimeout = processingTimeout;
    this.logger = logger;
    this.stream = client;

    // Registered after the client's own auth middleware, so it sees a 429 first.
    this.stream.use(
      createRateLimitMiddleware({
        maxRetries: MAX_RATE_LIMIT_RETRIES,
        logger,
        wait: options.retryWait,
      }),
    );
  }

  /** Per-request deadline. openapi-fetch takes a signal but has no timeout option. */
  private signal(ms = this.requestTimeout): AbortSignal {
    return AbortSignal.timeout(ms);
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
          signal: this.signal(),
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
        signal: this.signal(),
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
        signal: this.signal(),
      });

      const items = data?.items ?? [];
      videos.push(...items);
      if (!hasMorePages(data, items.length, page)) break;
    }

    return videos;
  }

  /** Returns null for a video that no longer exists. */
  async getVideo(videoId: string): Promise<BunnyVideo | null> {
    try {
      const { data } = await this.stream.GET(
        "/library/{libraryId}/videos/{videoId}",
        {
          params: { path: { ...this.path, videoId } },
          signal: this.signal(),
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
  ): Promise<void> {
    await this.stream.POST("/library/{libraryId}/videos/{videoId}", {
      params: { path: { ...this.path, videoId } },
      body: update,
      signal: this.signal(),
    });
  }

  /**
   * Ask Bunny to pull the video from `url`.
   *
   * Errors are returned rather than thrown so one bad video fails its own
   * entry instead of aborting the run.
   */
  async fetchVideoFromUrl(
    request: { url: string; title?: string; headers?: Record<string, string> },
    collectionId?: string,
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
          signal: this.signal(),
        },
      );

      const body = data as FetchVideoResponse | undefined;

      if (body?.success === false) {
        return {
          success: false,
          error: body.message ?? "Bunny rejected the fetch request",
        };
      }

      if (!body?.id) {
        return {
          success: false,
          error:
            "Bunny accepted the fetch but returned no video ID, so the video cannot be tracked or de-duplicated.",
        };
      }

      return { success: true, videoId: body.id };
    } catch (error) {
      if (error instanceof Error)
        return { success: false, error: error.message };

      return { success: false, error: "Video fetch failed" };
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

    if (metaTags.length > 0) await this.updateVideo(videoId, { metaTags });
  }

  /** Polls until the encoder finishes, errors, or the processing timeout hits. */
  async waitForVideoProcessing(
    videoId: string,
    onProgress?: (progress: number, status: number) => void,
    timeoutMs?: number,
  ): Promise<ProcessingResult> {
    const deadline = Date.now() + (timeoutMs ?? this.processingTimeout);

    while (Date.now() < deadline) {
      const video = await this.getVideo(videoId);
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
          await new Promise((r) => setTimeout(r, PROCESSING_POLL_INTERVAL_MS));
      }
    }

    return { success: false, error: "Processing timeout" };
  }
}

/**
 * Stream pagination has no `hasMoreItems` (Core does), so termination is
 * computed from the page counters. Comparing `items.length === perPage` would
 * cost an extra request whenever the total is an exact multiple of the page
 * size and loop forever if the server ignored `page`.
 *
 * The empty-page and page-bound guards keep a malformed envelope from
 * spinning: if the counters are missing, fall back to the page-size heuristic.
 */
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
