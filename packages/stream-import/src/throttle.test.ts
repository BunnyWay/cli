import { expect, mock, test } from "bun:test";
import type { BunnyStream, FetchVideoResult } from "./bunny-stream.ts";
import type { Logger, SourceAdapter } from "./contracts.ts";
import { MigrationService } from "./migration.ts";
import { Pacer } from "./throttle.ts";

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

test("a burst of rejections backs off once, up to two minutes, and the gap narrows again after 10 successes", async () => {
  const { pacer } = fakePacer(0);
  const turns = await Promise.all([pacer.turn(), pacer.turn(), pacer.turn()]);
  expect(turns.map((turn) => pacer.backoff(turn))).toEqual([
    15_000,
    undefined,
    undefined,
  ]);
  expect([pacer.backoff(), pacer.backoff(), pacer.backoff()]).toEqual([
    30_000, 60_000, 120_000,
  ]);
  expect(pacer.backoff()).toBeUndefined();

  const recovered = Array.from({ length: 40 }, () => pacer.succeeded());
  expect(recovered.filter((gap) => gap !== undefined)).toEqual([
    60_000, 30_000, 15_000, 0,
  ]);
});

const silent: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
};

/** A Vimeo import of `ids` against a Bunny whose fetch is `fetch`. */
function importOf(
  ids: string[],
  fetch: () => Promise<FetchVideoResult>,
  options: { logger?: Logger; lookupMs?: Record<string, number> } = {},
) {
  const adapter: SourceAdapter = {
    id: "vimeo",
    dedupTag: "vimeoId",
    validateCredentials: async () => {},
    listContent: async () => ({
      folders: [],
      videos: new Map(),
      uncategorizedVideos: ids.map((id) => ({
        sourceId: id,
        displayName: id,
        folderId: null,
      })),
    }),
    getDownloadInfo: async (id) => {
      const ms = options.lookupMs?.[id];
      if (ms) await Bun.sleep(ms);
      return { url: `https://player.vimeo.com/${id}.mp4`, title: id };
    },
  };
  const bunny = {
    listVideos: mock(async () => []),
    getOrCreateCollection: mock(async () => ({ guid: "c", name: "c" })),
    fetchVideoFromUrl: mock(fetch),
    setVideoMetadata: mock(async () => {}),
  } as unknown as BunnyStream;
  return new MigrationService({
    adapter,
    bunny,
    store: { load: () => null, save: () => {}, clear: () => {} },
    logger: options.logger ?? silent,
    libraryId: "12345",
    accountId: "acct-1",
    label: "Vimeo",
  });
}

test("a 422 from Bunny's fetch fails the video as a source rejection and slows the run down", async () => {
  const warnings: string[] = [];
  const service = importOf(
    ["111"],
    async () => ({ success: false, error: "Unable to fetch", status: 422 }),
    { logger: { ...silent, warn: (m) => warnings.push(m) } },
  );
  const [entry] = (await service.runMigration()).videoMigrations;
  expect(entry).toMatchObject({
    status: "failed",
    sourceRejected: true,
    error:
      "Import failed, try slowing down the import using delay or concurrency",
  });
  expect(warnings).toContain(
    "Videos are failing to import; slowing down to one new video every 15s.",
  );
});

test("the gap is kept between Bunny fetches even when source lookups take different times", async () => {
  const fetchedAt: number[] = [];
  // Without pacing the hand-off itself, the slow lookup would land its fetch right next to the fast one's.
  const service = importOf(
    ["slow", "fast"],
    async () => {
      fetchedAt.push(performance.now());
      return { success: true, videoId: `v${fetchedAt.length}` };
    },
    { lookupMs: { slow: 80 } },
  );
  await service.runMigration({ concurrency: 2, fetchIntervalMs: 60 });
  expect(fetchedAt).toHaveLength(2);
  const [first = 0, second = 0] = fetchedAt;
  expect(second - first).toBeGreaterThanOrEqual(55);
});

test("a pause during the pacing wait does not use up an attempt", async () => {
  const controller = new AbortController();
  // Pause once the first video is handed over, while the second waits its turn.
  const service = importOf(["first", "second"], async () => {
    controller.abort();
    return { success: true, videoId: "v1" };
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
