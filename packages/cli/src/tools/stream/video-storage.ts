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

export const VideoStorageSchema = z.object({
  library: z.number(),
  video: z.string(),
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
    try {
      const { data } = await client.GET(
        "/library/{libraryId}/videos/{videoId}/storage",
        {
          params: { path: { libraryId: id, videoId: video } },
          signal: ctx.signal,
        },
      );
      return toVideoStorage(id, video, data?.data);
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
