import { expect, mock, test } from "bun:test";
import type { BunnyStream } from "./bunny-stream.ts";
import type { Logger, SourceAdapter, StateStore } from "./contracts.ts";
import { MigrationService } from "./migration.ts";
import {
  largeLibraryProfile,
  MAX_BACKOFF_INTERVAL_MS,
  Pacer,
  SOURCE_REJECTED_MESSAGE,
  SourceRejectedError,
} from "./throttle.ts";

test("the pacer spaces starts across callers and does nothing at zero", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const pacer = new Pacer(
    10_000,
    async (ms) => {
      waits.push(ms);
    },
    () => now,
  );
  await pacer.turn();
  await pacer.turn();
  await pacer.turn();
  expect(waits).toEqual([10_000, 20_000]);

  now += 60_000;
  await pacer.turn();
  expect(waits).toHaveLength(2);

  const off = new Pacer(0, async () => {
    throw new Error("must not wait");
  });
  await off.turn();
  await off.turn();
});

test("backoff starts at 15s, doubles, and stops at two minutes", () => {
  const pacer = new Pacer(
    0,
    async () => {},
    () => 0,
  );
  expect(pacer.backoff()).toBe(15_000);
  expect(pacer.backoff()).toBe(30_000);
  expect(pacer.backoff()).toBe(60_000);
  expect(pacer.backoff()).toBe(MAX_BACKOFF_INTERVAL_MS);
  expect(pacer.backoff()).toBeUndefined();
  expect(pacer.interval).toBe(MAX_BACKOFF_INTERVAL_MS);
});

test("a rejection carries the generic message and keeps the HTTP status", () => {
  const error = new SourceRejectedError(422);
  expect(error.message).toBe(
    "Import failed, try slowing down the import using delay or concurrency",
  );
  expect(error.status).toBe(422);
});

test("the large-library profile applies only above its threshold", () => {
  const plugin = {
    largeLibrary: {
      threshold: 500,
      concurrency: 2,
      intervalSeconds: 10,
      requestTimeoutSeconds: 120,
    },
  };
  expect(largeLibraryProfile(plugin, 500)).toBeUndefined();
  expect(largeLibraryProfile(plugin, 501)?.concurrency).toBe(2);
  expect(largeLibraryProfile({}, 10_000)).toBeUndefined();
});

test("a 422 from Bunny's fetch fails the video as a source rejection and slows the run down", async () => {
  const warnings: string[] = [];
  const logger: Logger = {
    log: () => {},
    debug: () => {},
    info: () => {},
    success: () => {},
    warn: (m) => warnings.push(m),
    error: () => {},
    dim: () => {},
  };
  const store: StateStore = {
    load: () => null,
    save: () => {},
    clear: () => {},
  };
  const adapter: SourceAdapter = {
    id: "vimeo",
    dedupTag: "vimeoId",
    validateCredentials: async () => {},
    listContent: async () => ({
      folders: [],
      videos: new Map(),
      uncategorizedVideos: [
        { sourceId: "111", displayName: "Holiday", folderId: null },
      ],
    }),
    getDownloadInfo: async (id) => ({
      url: `https://player.vimeo.com/${id}.mp4`,
      title: `Video ${id}`,
    }),
  };
  const bunny = {
    listVideos: mock(async () => []),
    getOrCreateCollection: mock(async () => ({ guid: "c", name: "c" })),
    fetchVideoFromUrl: mock(async () => ({
      success: false,
      error: "Unable to fetch video from origin",
      status: 422,
    })),
    setVideoMetadata: mock(async () => {}),
  } as unknown as BunnyStream;

  const service = new MigrationService({
    adapter,
    bunny,
    store,
    logger,
    libraryId: "12345",
    accountId: "acct-1",
    label: "Vimeo",
  });
  const state = await service.runMigration();
  const [entry] = state.videoMigrations;
  expect(entry?.status).toBe("failed");
  expect(entry?.sourceRejected).toBe(true);
  expect(entry?.error).toBe(SOURCE_REJECTED_MESSAGE);
  expect(warnings).toContain(
    "Videos are failing to import; slowing down to one new video every 15s.",
  );
});
