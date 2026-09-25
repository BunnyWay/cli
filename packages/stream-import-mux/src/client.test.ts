import { expect, test } from "bun:test";
import { downloadForAsset } from "./client.ts";
import type { MuxAsset } from "./types.ts";

const asset = (overrides: Partial<MuxAsset>): MuxAsset => ({
  id: "a1",
  status: "ready",
  duration: 10,
  created_at: "0",
  master_access: "none",
  ...overrides,
});

const pub = { id: "pub", policy: "public" };
const file = (name: string, status?: string) => ({
  name,
  ext: "mp4",
  status,
  filesize: "42",
});

test("prefers a ready master, then only a rendition the asset reports ready, never an unsigned URL for a signed ID or an audio-only asset", () => {
  expect(
    downloadForAsset(
      asset({
        playback_ids: [pub],
        master_access: "temporary",
        master: { status: "ready", url: "https://master.mux.com/a1.mp4" },
        static_renditions: { files: [file("highest.mp4", "ready")] },
      }),
    ),
  ).toEqual({ url: "https://master.mux.com/a1.mp4", size: 0 });
  expect(
    downloadForAsset(
      asset({
        playback_ids: [pub],
        master_access: "temporary",
        master: { status: "preparing" },
        static_renditions: {
          files: [file("highest.mp4", "preparing"), file("720p.mp4", "ready")],
        },
      }),
    ),
  ).toEqual({ url: "https://stream.mux.com/pub/720p.mp4", size: 42 });
  expect(
    downloadForAsset(asset({ playback_ids: [pub], mp4_support: "standard" })),
  ).toBeNull();
  expect(
    downloadForAsset(
      asset({
        playback_ids: [{ id: "sig", policy: "signed" }],
        static_renditions: { status: "ready", files: [file("high.mp4")] },
      }),
    ),
  ).toBeNull();
  expect(
    downloadForAsset(
      asset({
        tracks: [{ type: "audio" }],
        master_access: "temporary",
        master: { status: "ready", url: "https://master.mux.com/a1.m4a" },
      }),
    ),
  ).toBeNull();
});
