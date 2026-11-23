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

/** A pacer on a fake clock: waiting advances it, and every wait is recorded. */
function fakePacer(interval: number) {
  const clock = { now: 1_000 };
  const waits: number[] = [];
  const pacer = new Pacer(
    interval,
    async (ms) => {
      waits.push(ms);
      clock.now += ms;
    },
    () => clock.now,
  );
  return { pacer, clock, waits };
}

test("the pacer spaces starts across callers and does nothing at zero", async () => {
  const { pacer, clock, waits } = fakePacer(10_000);
  await Promise.all([pacer.turn(), pacer.turn(), pacer.turn()]);
  expect(waits).toEqual([10_000, 10_000]);

  clock.now += 60_000;
  await pacer.turn();
  expect(waits).toHaveLength(2);

  const off = new Pacer(0, async () => {
    throw new Error("must not wait");
  });
  await off.turn();
  await off.turn();
});

test("a backoff also pushes out callers that were already waiting", async () => {
  const { pacer, clock } = fakePacer(10_000);
  const started: number[] = [];
  const take = () => pacer.turn().then(() => started.push(clock.now));
  const first = take();
  const queued = [take(), take()];
  await first;
  // The first hand-off is rejected before the others start.
  // Doubled from 10s.
  expect(pacer.backoff()).toBe(20_000);
  await Promise.all(queued);
  expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(20_000);
  expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(20_000);
});

test("an aborted caller takes no turn and does not hold up the queue", async () => {
  const { pacer, waits } = fakePacer(10_000);
  await pacer.turn();
  const aborted = AbortSignal.abort();
  await pacer.turn(aborted);
  expect(waits).toEqual([]);
  await pacer.turn();
  expect(waits).toEqual([10_000]);
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

test("the gap is kept between Bunny fetches even when source lookups take different times", async () => {
  const fetchedAt: number[] = [];
  const adapter: SourceAdapter = {
    id: "vimeo",
    dedupTag: "vimeoId",
    validateCredentials: async () => {},
    listContent: async () => ({
      folders: [],
      videos: new Map(),
      uncategorizedVideos: [
        { sourceId: "slow", displayName: "Slow", folderId: null },
        { sourceId: "fast", displayName: "Fast", folderId: null },
      ],
    }),
    // The first lookup is slow, so without pacing the hand-off itself the
    // second video's fetch would land right next to the first one.
    getDownloadInfo: async (id) => {
      if (id === "slow") await Bun.sleep(80);
      return { url: `https://player.vimeo.com/${id}.mp4`, title: id };
    },
  };
  let n = 0;
  const bunny = {
    listVideos: mock(async () => []),
    getOrCreateCollection: mock(async () => ({ guid: "c", name: "c" })),
    fetchVideoFromUrl: mock(async () => {
      fetchedAt.push(performance.now());
      return { success: true, videoId: `v${++n}` };
    }),
    setVideoMetadata: mock(async () => {}),
  } as unknown as BunnyStream;
  const service = new MigrationService({
    adapter,
    bunny,
    store: { load: () => null, save: () => {}, clear: () => {} },
    logger: {
      log: () => {},
      debug: () => {},
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      dim: () => {},
    },
    libraryId: "12345",
    accountId: "acct-1",
    label: "Vimeo",
  });
  await service.runMigration({ concurrency: 2, fetchIntervalMs: 60 });
  expect(fetchedAt).toHaveLength(2);
  const [first = 0, second = 0] = [...fetchedAt].sort((a, b) => a - b);
  expect(second - first).toBeGreaterThanOrEqual(55);
});

test("a pause during the pacing wait does not use up an attempt", async () => {
  const controller = new AbortController();
  const adapter: SourceAdapter = {
    id: "vimeo",
    dedupTag: "vimeoId",
    validateCredentials: async () => {},
    listContent: async () => ({
      folders: [],
      videos: new Map(),
      uncategorizedVideos: [
        { sourceId: "first", displayName: "First", folderId: null },
        { sourceId: "second", displayName: "Second", folderId: null },
      ],
    }),
    getDownloadInfo: async (id) => ({
      url: `https://player.vimeo.com/${id}.mp4`,
      title: id,
    }),
  };
  const bunny = {
    listVideos: mock(async () => []),
    getOrCreateCollection: mock(async () => ({ guid: "c", name: "c" })),
    // Pause the run once the first video is handed over, while the second waits its turn.
    fetchVideoFromUrl: mock(async () => {
      controller.abort();
      return { success: true, videoId: "v1" };
    }),
    setVideoMetadata: mock(async () => {}),
  } as unknown as BunnyStream;
  const service = new MigrationService({
    adapter,
    bunny,
    store: { load: () => null, save: () => {}, clear: () => {} },
    logger: {
      log: () => {},
      debug: () => {},
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      dim: () => {},
    },
    libraryId: "12345",
    accountId: "acct-1",
    label: "Vimeo",
  });
  const state = await service.runMigration({
    concurrency: 2,
    fetchIntervalMs: 60_000,
    signal: controller.signal,
  });
  const waiting = state.videoMigrations.find((m) => !m.bunnyVideoId);
  expect(waiting?.status).toBe("pending");
  expect(waiting?.attempts ?? 0).toBe(0);
});
