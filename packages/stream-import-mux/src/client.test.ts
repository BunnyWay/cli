import { expect, test } from "bun:test";
import { downloadForAsset } from "./client.ts";
import type { MuxAsset } from "./types.ts";

const asset = (overrides: Partial<MuxAsset>): MuxAsset => ({
  id: "a1",
  status: "ready",
  duration: 10,
  created_at: "0",
  master_access: "none",
  mp4_support: "standard",
  ...overrides,
});

test("a signed-only asset never yields an unsigned stream.mux.com URL", () => {
  const signed = { id: "sig", policy: "signed" };
  expect(
    downloadForAsset(
      asset({
        playback_ids: [signed],
        master_access: "temporary",
        master: { status: "ready", url: "https://master.mux.com/a1.mp4" },
      }),
    ),
  ).toEqual({ url: "https://master.mux.com/a1.mp4", size: 0 });
  expect(downloadForAsset(asset({ playback_ids: [signed] }))).toBeNull();
  expect(
    downloadForAsset(
      asset({
        playback_ids: [signed, { id: "pub", policy: "public" }],
        static_renditions: {
          status: "ready",
          files: [
            {
              name: "high.mp4",
              ext: "mp4",
              width: 1920,
              height: 1080,
              bitrate: 1,
              filesize: 42,
            },
          ],
        },
      }),
    ),
  ).toEqual({ url: "https://stream.mux.com/pub/high.mp4", size: 42 });
});
