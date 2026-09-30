import { z } from "zod";
import type { VideoLibraryModel } from "./api.ts";

/** Credential-free view of a video library: the library's own Stream key is never part of it. */
export const StreamLibrarySchema = z.object({
  id: z.number(),
  name: z.string(),
  videoCount: z.number(),
});

export type StreamLibrary = z.infer<typeof StreamLibrarySchema>;

export function toStreamLibrary(library: VideoLibraryModel): StreamLibrary {
  return {
    id: library.Id ?? 0,
    name: library.Name ?? "",
    videoCount: library.VideoCount ?? 0,
  };
}
