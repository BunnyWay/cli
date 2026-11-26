import { ApiError, UserError } from "@bunny.net/openapi-client";
import type { components as StreamComponents } from "@bunny.net/openapi-client/stream";
import { z } from "zod";
import { defineTool } from "@/tools/define-tool.ts";
import { openStreamLibrary } from "./connect.ts";

const libraryId = z
  .number()
  .int()
  .positive()
  .describe("Video library ID, e.g. `12345`.");

type StorageModel = StreamComponents["schemas"]["VideoStorageSizeModel"];

const VIDEOS_PER_PAGE = 100;

export const VideoSummarySchema = z.object({
  guid: z.string(),
  title: z.string(),
  /** Encoding status code (0 created ... 4 finished, 5 error). */
  status: z.number().nullable(),
});
export type VideoSummary = z.infer<typeof VideoSummarySchema>;

export const streamVideosList = defineTool({
  name: "stream.videos.list",
  title: "List a library's videos",
  description:
    "List every video in a video library with its GUID, title and encoding status.",
  schema: z.strictObject({ library: libraryId }),
  kind: "read",
  resultSchema: z.array(VideoSummarySchema),
  run: async (ctx, { library: id }) => {
    const { client } = await openStreamLibrary(ctx, id);
    ctx.progress("Fetching videos...");
    const videos: VideoSummary[] = [];
    for (let page = 1; ; page++) {
      const { data } = await client.GET("/library/{libraryId}/videos", {
        params: {
          path: { libraryId: id },
          query: { page, itemsPerPage: VIDEOS_PER_PAGE },
        },
        signal: ctx.signal,
      });
      const items = data?.items ?? [];
      for (const video of items)
        videos.push({
          guid: video.guid ?? "",
          title: video.title ?? "",
          status: video.status ?? null,
        });
      // A reported total is a ceiling; otherwise only a full page implies another.
      const total = data?.totalItems;
      if (total !== undefined && videos.length >= total) break;
      if (items.length < (data?.itemsPerPage ?? VIDEOS_PER_PAGE)) break;
    }
    return videos.filter((video) => video.guid);
  },
});

export const VideoStorageSchema = z.object({
  library: z.number(),
  video: z.string(),
  title: z.string().nullable(),
  totalBytes: z.number(),
  renditions: z.array(
    z.object({
      resolution: z.string(),
      codec: z.string(),
      bytes: z.number(),
    }),
  ),
  originalBytes: z.number(),
  mp4FallbackBytes: z.number(),
  thumbnailBytes: z.number(),
  previewBytes: z.number(),
  otherBytes: z.number(),
  calculatedAt: z.string().nullable(),
});
export type VideoStorage = z.infer<typeof VideoStorageSchema>;

export function toVideoStorage(
  libraryId: number,
  video: string,
  model: StorageModel | null | undefined,
  title: string | null = null,
): VideoStorage {
  const renditions = Object.entries(model?.encoded ?? {})
    .map(([key, r]) => {
      const [resolution, codec] = key.split("-");
      return {
        resolution: r.resolution ?? resolution ?? key,
        codec: r.codec ?? codec ?? "",
        bytes: r.size ?? 0,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
  const parts = {
    originalBytes: model?.originals ?? 0,
    mp4FallbackBytes: model?.mp4Fallback ?? 0,
    thumbnailBytes: model?.thumbnails ?? 0,
    previewBytes: model?.previews ?? 0,
    otherBytes: model?.miscellaneous ?? 0,
  };
  const totalBytes =
    renditions.reduce((sum, r) => sum + r.bytes, 0) +
    Object.values(parts).reduce((sum, v) => sum + v, 0);
  return {
    library: libraryId,
    video,
    title,
    totalBytes,
    renditions,
    ...parts,
    calculatedAt: model?.calculatedAt ?? null,
  };
}

export const streamVideoStorage = defineTool({
  name: "stream.videos.storage",
  title: "Get a video's storage breakdown",
  description:
    "Get how much storage one video uses, split into each encoded rendition (resolution and codec), the original file, MP4 fallback, thumbnails, previews and everything else.",
  schema: z.strictObject({
    library: libraryId,
    video: z.string().trim().min(1).describe("Video GUID."),
  }),
  kind: "read",
  resultSchema: VideoStorageSchema,
  run: async (ctx, { library: id, video }) => {
    const { client } = await openStreamLibrary(ctx, id);
    ctx.progress("Measuring storage...");
    const path = { libraryId: id, videoId: video };
    try {
      const [details, storage] = await Promise.all([
        client.GET("/library/{libraryId}/videos/{videoId}", {
          params: { path },
          signal: ctx.signal,
        }),
        client.GET("/library/{libraryId}/videos/{videoId}/storage", {
          params: { path },
          signal: ctx.signal,
        }),
      ]);
      // A 200 can still carry a failed status envelope; never report it as zero bytes.
      const envelope = storage.data;
      if (envelope?.success === false || !envelope?.data)
        throw new UserError(
          envelope?.message ||
            `The storage size of video ${video} couldn't be read.`,
          "Try again in a minute.",
        );
      return toVideoStorage(
        id,
        video,
        envelope.data,
        details.data?.title ?? null,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        throw new UserError(`Video ${video} not found.`);
      if (err instanceof ApiError && (err.status === 429 || err.status === 408))
        throw new UserError(
          "The storage size couldn't be calculated right now.",
          "Try again in a minute.",
        );
      throw err;
    }
  },
});
