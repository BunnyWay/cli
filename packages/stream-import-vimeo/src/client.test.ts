import { expect, test } from "bun:test";
import { selectDownload } from "./client.ts";
import type { VimeoFile, VimeoVideo } from "./types.ts";

const file = (quality: string, link: string, height: number): VimeoFile => ({
  quality,
  type: "video/mp4",
  width: 0,
  height,
  link,
  size: 1,
});

test("the files fallback picks a progressive MP4, never an HLS or DASH manifest", () => {
  const video = {
    files: [
      file("hls", "https://player.vimeo.com/external/1.m3u8?s=x", 2160),
      file("dash", "https://player.vimeo.com/external/1.mpd?s=x", 2160),
      file("hd", "https://player.vimeo.com/progressive/1080.mp4", 1080),
    ],
  } as VimeoVideo;
  expect(selectDownload(video)?.link).toBe(
    "https://player.vimeo.com/progressive/1080.mp4",
  );
});
