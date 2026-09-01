import { createStreamClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/stream.d.ts";
import type { ResolvedConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { errorMessage, UserError } from "../../core/errors.ts";
import type { VideoLibraryModel } from "./api.ts";

export type StreamClient = ReturnType<typeof createStreamClient>;
export type VideoModel = components["schemas"]["VideoModel"];
export type UpdateVideoModel = components["schemas"]["UpdateVideoModel"];
export type FetchVideoRequest = components["schemas"]["FetchVideoRequest"];
export type StatusModel = components["schemas"]["StatusModel"];

// The listing endpoint's documented default; it has no documented maximum, so
// asking for more risks a clamp or a 400. Draining below tolerates either.
const VIDEOS_PER_PAGE = 100;

/** Titles for VideoModel.status, in the order the spec enumerates them. */
const VIDEO_STATUS_LABELS = [
  "Created",
  "Uploaded",
  "Processing",
  "Transcoding",
  "Finished",
  "Error",
  "UploadFailed",
  "JitSegmenting",
  "JitPlaylistsCreated",
];

export function videoStatusLabel(status: number | undefined): string {
  if (status === undefined) return "—";
  return VIDEO_STATUS_LABELS[status] ?? String(status);
}

/** A video length in seconds as `m:ss`, or `h:mm:ss` once it reaches an hour. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const total = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/**
 * The video's Direct Play URL, as the bunny.net dashboard calls it.
 *
 * Derived from the library and video IDs, so it needs no extra API call.
 */
export function directPlayUrl(libraryId: number, videoId: string): string {
  return `https://iframe.mediadelivery.net/play/${libraryId}/${videoId}`;
}

/**
 * Build a Stream API client for one video library.
 *
 * The video-level API lives on its own host and authenticates with the
 * library's own key, so the account key and the core API base URL from the
 * CLI config are both dropped here.
 */
export function connectStreamLibrary(
  library: VideoLibraryModel,
  opts: { config: ResolvedConfig; verbose?: boolean },
): StreamClient {
  if (!library.ApiKey) {
    throw new UserError(
      `No API key available for video library ${library.Name ?? library.Id}.`,
      "Video operations need the library's own Stream API key; check that the account key can read it.",
    );
  }

  // baseUrl is the core API host: leaving it in would point the Stream client at api.bunny.net.
  const { baseUrl: _core, ...options } = clientOptions(
    opts.config,
    opts.verbose,
  );
  return createStreamClient({ ...options, apiKey: library.ApiKey });
}

/** Create the video entry that the file bytes are then uploaded into. */
export async function createVideo(
  client: StreamClient,
  libraryId: number,
  title: string,
): Promise<VideoModel> {
  const { data } = await client.POST("/library/{libraryId}/videos", {
    params: { path: { libraryId } },
    body: { title },
  });
  if (!data?.guid) {
    throw new UserError(
      `Creating the video "${title}" did not return a video ID.`,
    );
  }
  return data;
}

/**
 * Fetch every video in a library, draining the paginated listing.
 *
 * This endpoint reports `totalItems` but no "has more" flag, so paging stops
 * once the caller holds everything the server counted. An empty page also
 * stops it, so a stale or wrong `totalItems` can't spin forever, and a server
 * that clamps `itemsPerPage` below the request is handled the same way.
 */
export async function fetchVideos(
  client: StreamClient,
  libraryId: number,
  opts: { search?: string } = {},
): Promise<VideoModel[]> {
  const videos: VideoModel[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/library/{libraryId}/videos", {
      params: {
        path: { libraryId },
        query: {
          page,
          itemsPerPage: VIDEOS_PER_PAGE,
          search: opts.search,
        },
      },
    });
    const items = data?.items ?? [];
    videos.push(...items);
    if (items.length === 0) break;
    if (videos.length >= (data?.totalItems ?? videos.length)) break;
    page++;
  }
  return videos;
}

/** Fetch a video's current state (encoding status, size, resolutions). */
export async function fetchVideo(
  client: StreamClient,
  libraryId: number,
  videoId: string,
): Promise<VideoModel> {
  const { data } = await client.GET("/library/{libraryId}/videos/{videoId}", {
    params: { path: { libraryId, videoId } },
  });
  if (!data) throw new UserError(`Video ${videoId} not found.`);
  return data;
}

// The shared middleware turns a non-OK response into an ApiError, so an `error`
// body only reaches the caller in odd cases; read the API's message out of it anyway.
function bodyMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const body = error as { message?: string | null; Message?: string } | null;
  return body?.message ?? body?.Message ?? JSON.stringify(error);
}

/**
 * Upload the file's bytes into an existing video.
 *
 * The endpoint takes a raw `application/octet-stream` body. openapi-fetch
 * JSON-stringifies request bodies by default, so this passes an identity
 * `bodySerializer` and hands it a `Bun.file` blob: fetch streams that straight
 * off disk (and sets Content-Length) instead of buffering the video in memory.
 */
export async function uploadVideoFile(
  client: StreamClient,
  libraryId: number,
  videoId: string,
  filePath: string,
): Promise<void> {
  const file = Bun.file(filePath);
  try {
    const { error } = await client.PUT(
      "/library/{libraryId}/videos/{videoId}",
      {
        params: { path: { libraryId, videoId } },
        headers: { "Content-Type": "application/octet-stream" },
        bodySerializer: (body: unknown) => body,
        // The generated type for an octet-stream body is `string`; the blob is what actually gets sent.
        body: file as unknown as string,
      },
    );
    if (error) {
      throw new UserError(
        `Uploading ${filePath} failed: ${bodyMessage(error)}`,
      );
    }
  } catch (err) {
    if (err instanceof UserError) throw err;
    // A non-OK response arrives here as an ApiError from the shared middleware.
    throw new UserError(`Uploading ${filePath} failed: ${errorMessage(err)}`);
  }
}

/**
 * Ask bunny.net to fetch a video from a URL itself, server side.
 *
 * The response is a plain status with no video GUID, so this can only report
 * that the fetch was queued: the video shows up in the library once bunny.net
 * has downloaded and encoded it.
 */
export async function queueVideoFetch(
  client: StreamClient,
  libraryId: number,
  body: FetchVideoRequest,
): Promise<StatusModel> {
  const { data } = await client.POST("/library/{libraryId}/videos/fetch", {
    params: { path: { libraryId } },
    body,
  });

  // 200 with success: false is how this endpoint reports a rejected URL.
  if (data && data.success === false) {
    throw new UserError(
      `bunny.net could not fetch ${body.url}: ${data.message ?? "the request was rejected"}`,
    );
  }
  return data ?? {};
}

/** Update a video's metadata. Only the fields present in `body` change. */
export async function updateVideo(
  client: StreamClient,
  libraryId: number,
  videoId: string,
  body: UpdateVideoModel,
): Promise<void> {
  await client.POST("/library/{libraryId}/videos/{videoId}", {
    params: { path: { libraryId, videoId } },
    body,
  });
}

/** Delete a video. Used as best-effort cleanup when an upload fails part-way. */
export async function deleteVideo(
  client: StreamClient,
  libraryId: number,
  videoId: string,
): Promise<void> {
  await client.DELETE("/library/{libraryId}/videos/{videoId}", {
    params: { path: { libraryId, videoId } },
  });
}
