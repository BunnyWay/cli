import { expect, mock, test } from "bun:test";
import type { BunnyStream } from "./bunny-stream.ts";
import type { MigrationState, VideoMigration } from "./contracts.ts";
import { refreshMigrationState } from "./status.ts";

const entry = (
  sourceVideoId: string,
  bunnyVideoId: string | null,
  status: VideoMigration["status"],
): VideoMigration => ({
  sourceVideoId,
  videoName: sourceVideoId,
  sourceFolderId: null,
  bunnyVideoId,
  bunnyCollectionId: null,
  status,
  error: null,
  startedAt: null,
  completedAt: null,
  encodeProgress: 0,
});

test("pulls each entry's Bunny status into the state and settles the run status", async () => {
  const state: MigrationState = {
    id: "m",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "vimeo",
    bunnyLibraryId: "1",
    folderMappings: [],
    status: "in_progress",
    videoMigrations: [
      entry("done", "g-done", "processing"),
      entry("busy", "g-busy", "processing"),
      entry("dead", "g-dead", "processing"),
      entry("gone", "g-gone", "processing"),
      entry("never", null, "pending"),
    ],
  };
  const bunny = {
    listVideos: mock(async () => [
      { guid: "g-done", status: 4, encodeProgress: 100, storageSize: 10 },
      { guid: "g-busy", status: 3, encodeProgress: 55 },
      { guid: "g-dead", status: 6 },
    ]),
  } as unknown as BunnyStream;

  const { state: refreshed, videos } = await refreshMigrationState(
    state,
    bunny,
  );

  expect(
    refreshed.videoMigrations.map((m) => [m.status, m.encodeProgress]),
  ).toEqual([
    ["completed", 100],
    ["processing", 55],
    ["failed", 0],
    ["failed", 0],
    ["pending", 0],
  ]);
  expect(refreshed.videoMigrations[3]?.error).toMatch(/no longer exists/);
  expect(refreshed.status).toBe("failed");
  expect(videos.get("g-done")?.storageSize).toBe(10);
});
