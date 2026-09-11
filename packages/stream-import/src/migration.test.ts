import { describe, expect, mock, test } from "bun:test";
import type { BunnyStream } from "./bunny-stream.ts";
import type {
  Logger,
  MigrationState,
  SourceAdapter,
  SourceContent,
  StateStore,
} from "./contracts.ts";
import { MigrationService, runPool } from "./migration.ts";

const silentLogger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
};

function memoryStore(initial: MigrationState | null = null) {
  let state = initial;
  const saves: MigrationState[] = [];
  const store: StateStore = {
    load: () => (state ? structuredClone(state) : null),
    save: (s) => {
      state = structuredClone(s);
      saves.push(state);
    },
    clear: () => {
      state = null;
    },
  };
  return { store, saves };
}

function content(overrides: Partial<SourceContent> = {}): SourceContent {
  return {
    folders: [],
    videos: new Map(),
    uncategorizedVideos: [],
    ...overrides,
  };
}

function fakeAdapter(overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    id: "vimeo",
    dedupTag: "vimeoId",
    validateCredentials: async () => {},
    listContent: async () => content(),
    getDownloadInfo: async (sourceId) => ({
      url: `https://player.vimeo.com/${sourceId}.mp4`,
      title: `Video ${sourceId}`,
    }),
    ...overrides,
  };
}

function fakeBunny(overrides: Record<string, unknown> = {}): BunnyStream {
  return {
    listVideos: mock(async () => []),
    getOrCreateCollection: mock(async (name: string) => ({
      guid: `col-${name}`,
      name,
    })),
    fetchVideoFromUrl: mock(async () => ({
      success: true,
      videoId: "bunny-1",
    })),
    setVideoMetadata: mock(async () => {}),
    waitForVideoProcessing: mock(async () => ({ success: true })),
    ...overrides,
  } as unknown as BunnyStream;
}

function service(opts: {
  adapter?: SourceAdapter;
  bunny?: BunnyStream;
  store?: StateStore;
  accountId?: string;
}) {
  return new MigrationService({
    adapter: opts.adapter ?? fakeAdapter(),
    bunny: opts.bunny ?? fakeBunny(),
    store: opts.store ?? memoryStore().store,
    logger: silentLogger,
    libraryId: "12345",
    accountId: opts.accountId ?? "acct-1",
    label: "Vimeo",
  });
}

const oneVideo = () =>
  content({
    uncategorizedVideos: [
      { sourceId: "111", displayName: "Holiday", folderId: null, size: 10 },
    ],
  });

describe("getSummary", () => {
  test("separates already-imported videos from new ones and discovers the source once", async () => {
    const listContent = mock(async () =>
      content({
        uncategorizedVideos: [
          { sourceId: "111", displayName: "Old", folderId: null },
          { sourceId: "222", displayName: "New", folderId: null },
        ],
      }),
    );
    const listVideos = mock(async () => [
      {
        guid: "b1",
        status: 4,
        metaTags: [{ property: "vimeoId", value: "111" }],
      },
    ]);
    const svc = service({
      adapter: fakeAdapter({ listContent }),
      bunny: fakeBunny({ listVideos }),
    });

    const summary = await svc.getSummary();
    await svc.runMigration();

    expect(summary.alreadyMigrated).toBe(1);
    expect(summary.newVideosList).toEqual([{ name: "New", folder: null }]);
    expect(summary.totalSize).toBe(0);
    expect(listContent).toHaveBeenCalledTimes(1);
    expect(listVideos).toHaveBeenCalledTimes(1);
  });
});

describe("runMigration", () => {
  test("fetches, tags with the dedup property plus sanitized metadata, and completes", async () => {
    const bunny = fakeBunny();
    const state = await service({
      adapter: fakeAdapter({
        listContent: async () => oneVideo(),
        getDownloadInfo: async () => ({
          url: "https://player.vimeo.com/a.mp4",
          title: "Holiday",
          description: "Summer trip",
          tags: ["beach", "2024"],
        }),
      }),
      bunny,
    }).runMigration({ wait: true });

    expect(bunny.setVideoMetadata).toHaveBeenCalledWith(
      "bunny-1",
      {
        sourceId: "111",
        sourceIdProperty: "vimeoId",
        description: "Summer trip",
        tags: ["beach", "2024"],
      },
      expect.any(AbortSignal),
    );
    expect(state.status).toBe("completed");
    expect(state.videoMigrations[0]).toMatchObject({
      status: "completed",
      bunnyVideoId: "bunny-1",
    });
  });

  test("skips a video the dedup index already knows about", async () => {
    const bunny = fakeBunny({
      listVideos: mock(async () => [
        {
          guid: "existing",
          status: 4,
          metaTags: [{ property: "vimeoId", value: "111" }],
        },
      ]),
    });

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny,
    }).runMigration();

    expect(bunny.fetchVideoFromUrl).not.toHaveBeenCalled();
    expect(state.videoMigrations[0]).toMatchObject({
      bunnyVideoId: "existing",
      status: "completed",
    });
  });

  test("by default hands the videos to Bunny and returns without waiting for encoding", async () => {
    const bunny = fakeBunny();
    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny,
    }).runMigration();

    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(bunny.setVideoMetadata).toHaveBeenCalledTimes(1);
    expect(bunny.waitForVideoProcessing).not.toHaveBeenCalled();
    expect(state.videoMigrations[0]?.status).toBe("processing");
    expect(state.status).toBe("in_progress");
  });

  test("a tagged video Bunny is still working on is reported and left alone; one Bunny failed is imported again", async () => {
    const bunny = fakeBunny({
      listVideos: mock(async () => [
        {
          guid: "busy",
          status: 2,
          encodeProgress: 40,
          metaTags: [{ property: "vimeoId", value: "111" }],
        },
        {
          guid: "dead",
          status: 6,
          metaTags: [{ property: "vimeoId", value: "222" }],
        },
      ]),
    });
    const svc = service({
      adapter: fakeAdapter({
        listContent: async () =>
          content({
            uncategorizedVideos: [
              { sourceId: "111", displayName: "Busy", folderId: null },
              { sourceId: "222", displayName: "Dead", folderId: null },
            ],
          }),
      }),
      bunny,
    });

    const summary = await svc.getSummary();
    expect(summary).toMatchObject({
      alreadyMigrated: 0,
      processingOnBunny: 1,
      failedOnBunny: 1,
      newVideos: 1,
    });

    const state = await svc.runMigration();
    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(bunny.setVideoMetadata).toHaveBeenCalledTimes(1);
    expect(state.videoMigrations[0]).toMatchObject({
      bunnyVideoId: "busy",
      status: "processing",
      encodeProgress: 40,
    });
    expect(state.videoMigrations[1]?.bunnyVideoId).toBe("bunny-1");
  });

  test("maps folders to collections and scopes to one folder when asked", async () => {
    const bunny = fakeBunny();
    const state = await service({
      adapter: fakeAdapter({
        listContent: async () =>
          content({
            folders: [
              { id: "f1", name: "Keep", videoCount: 1 },
              { id: "f2", name: "Skip", videoCount: 1 },
            ],
            videos: new Map([
              [
                "f1",
                [{ sourceId: "1", displayName: "Keep me", folderId: "f1" }],
              ],
              [
                "f2",
                [{ sourceId: "2", displayName: "Skip me", folderId: "f2" }],
              ],
            ]),
            uncategorizedVideos: [
              { sourceId: "3", displayName: "Loose", folderId: null },
            ],
          }),
      }),
      bunny,
    }).runMigration({ folderId: "f1" });

    expect(bunny.getOrCreateCollection).toHaveBeenCalledTimes(1);
    expect(state.folderMappings[0]?.bunnyCollectionId).toBe("col-Keep");
    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledWith(
      expect.anything(),
      "col-Keep",
      expect.any(AbortSignal),
    );
    expect(state.videoMigrations.map((m) => m.sourceVideoId)).toEqual(["1"]);
  });

  test("refuses a URL the adapter rejects, and non-HTTPS by default", async () => {
    const bunny = fakeBunny();
    const rejected = await service({
      adapter: fakeAdapter({
        listContent: async () => oneVideo(),
        validateUrl: () => false,
      }),
      bunny,
    }).runMigration();
    expect(rejected.videoMigrations[0]?.error).toMatch(/not an allowed host/);

    const insecure = await service({
      adapter: fakeAdapter({
        listContent: async () => oneVideo(),
        getDownloadInfo: async () => ({
          url: "http://insecure.example.com/a.mp4",
          title: "A",
        }),
      }),
      bunny,
    }).runMigration();
    expect(insecure.videoMigrations[0]?.status).toBe("failed");
    expect(bunny.fetchVideoFromUrl).not.toHaveBeenCalled();
  });

  test("marks a mixed run failed so it stays resumable", async () => {
    const bunny = fakeBunny({
      fetchVideoFromUrl: mock()
        .mockResolvedValueOnce({ success: true, videoId: "ok" })
        .mockResolvedValueOnce({ success: false, error: "upstream exploded" }),
    });

    const state = await service({
      adapter: fakeAdapter({
        listContent: async () =>
          content({
            uncategorizedVideos: [
              { sourceId: "1", displayName: "Good", folderId: null },
              { sourceId: "2", displayName: "Bad", folderId: null },
            ],
          }),
      }),
      bunny,
    }).runMigration({ concurrency: 1, wait: true });

    expect(state.status).toBe("failed");
    expect(state.videoMigrations.map((m) => m.status)).toEqual([
      "completed",
      "failed",
    ]);
  });

  test("a video that exceeds the per-video timeout fails, is cancelled, and cannot complete late", async () => {
    let seen: AbortSignal | undefined;
    // Stands in for a poll that only notices the abort a moment later and then reports success.
    const waitForVideoProcessing = mock(
      (_id: string, _cb: unknown, _t: unknown, signal: AbortSignal) => {
        seen = signal;
        return new Promise((resolve) =>
          signal.addEventListener("abort", () =>
            setTimeout(() => resolve({ success: true }), 5),
          ),
        );
      },
    );

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny: fakeBunny({ waitForVideoProcessing }),
    }).runMigration({ migrationTimeoutMs: 20, wait: true });
    await new Promise((r) => setTimeout(r, 30));

    expect(seen?.aborted).toBe(true);
    expect(state.videoMigrations[0]?.status).toBe("failed");
    expect(state.videoMigrations[0]?.error).toMatch(/timeout/i);
  });

  test("propagates an unexpected escape instead of silently ignoring it", async () => {
    const bunny = fakeBunny({
      listVideos: mock(async () => {
        throw new Error("Bunny is down");
      }),
    });

    await expect(
      service({
        adapter: fakeAdapter({ listContent: async () => oneVideo() }),
        bunny,
      }).runMigration(),
    ).rejects.toThrow("Bunny is down");
  });
});

describe("resume", () => {
  const savedState = (
    overrides: Partial<MigrationState> = {},
  ): MigrationState => ({
    id: "migration-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "vimeo",
    bunnyLibraryId: "12345",
    bunnyAccountId: "acct-1",
    folderMappings: [],
    videoMigrations: [
      {
        sourceVideoId: "111",
        videoName: "Holiday",
        sourceFolderId: null,
        bunnyVideoId: null,
        bunnyCollectionId: null,
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: "2026-01-01T00:00:00.000Z",
        encodeProgress: 100,
      },
      {
        sourceVideoId: "222",
        videoName: "Work",
        sourceFolderId: null,
        bunnyVideoId: null,
        bunnyCollectionId: null,
        status: "pending",
        error: null,
        startedAt: null,
        completedAt: null,
        encodeProgress: 0,
      },
    ],
    status: "failed",
    ...overrides,
  });

  const twoVideos = () =>
    content({
      uncategorizedVideos: [
        { sourceId: "111", displayName: "Holiday", folderId: null },
        { sourceId: "222", displayName: "Work", folderId: null },
      ],
    });

  test("resumes a failed run and only works the outstanding videos", async () => {
    const bunny = fakeBunny();
    const { store } = memoryStore(savedState());

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => twoVideos() }),
      bunny,
      store,
    }).runMigration({ resume: true });

    expect(state.id).toBe("migration-1");
    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledTimes(1);
  });

  test("re-asserts the dedup tag on a video interrupted mid-processing instead of re-fetching", async () => {
    const bunny = fakeBunny();
    const { store } = memoryStore(
      savedState({
        videoMigrations: [
          {
            sourceVideoId: "222",
            videoName: "Work",
            sourceFolderId: null,
            bunnyVideoId: "orphan-guid",
            bunnyCollectionId: null,
            status: "processing",
            error: null,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: null,
            encodeProgress: 40,
          },
        ],
      }),
    );

    await service({
      adapter: fakeAdapter({
        listContent: async () =>
          content({
            uncategorizedVideos: [
              { sourceId: "222", displayName: "Work", folderId: null },
            ],
          }),
      }),
      bunny,
      store,
    }).runMigration({ resume: true });

    expect(bunny.fetchVideoFromUrl).not.toHaveBeenCalled();
    expect(bunny.setVideoMetadata).toHaveBeenCalledWith(
      "orphan-guid",
      { sourceId: "222", sourceIdProperty: "vimeoId" },
      expect.any(AbortSignal),
    );
  });

  test("retries failed entries: a fresh fetch without a video, a re-tag with saved metadata when there is one", async () => {
    const bunny = fakeBunny();
    const { store } = memoryStore(
      savedState({
        videoMigrations: [
          {
            sourceVideoId: "111",
            videoName: "Holiday",
            sourceFolderId: null,
            bunnyVideoId: null,
            bunnyCollectionId: null,
            status: "failed",
            error: "No download link available",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: null,
            encodeProgress: 0,
          },
          {
            sourceVideoId: "222",
            videoName: "Work",
            sourceFolderId: null,
            bunnyVideoId: "half-done",
            bunnyCollectionId: null,
            status: "failed",
            error: "Processing timeout",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: null,
            encodeProgress: 40,
            description: "Quarterly update",
            tags: ["q1", "all-hands"],
          },
        ],
      }),
    );

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => twoVideos() }),
      bunny,
      store,
    }).runMigration({ resume: true, wait: true });

    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(bunny.setVideoMetadata).toHaveBeenCalledWith(
      "half-done",
      expect.objectContaining({
        sourceId: "222",
        description: "Quarterly update",
        tags: ["q1", "all-hands"],
      }),
      expect.any(AbortSignal),
    );
    expect(state.videoMigrations.map((m) => m.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  test("a fresh run re-tags a video Bunny holds untagged from a dead run instead of fetching it again", async () => {
    const { store } = memoryStore(
      savedState({
        videoMigrations: [
          {
            sourceVideoId: "222",
            videoName: "Work",
            sourceFolderId: null,
            bunnyVideoId: "orphan",
            bunnyCollectionId: null,
            status: "processing",
            error: null,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: null,
            encodeProgress: 0,
          },
          {
            sourceVideoId: "111",
            videoName: "Holiday",
            sourceFolderId: null,
            bunnyVideoId: "deleted-in-dashboard",
            bunnyCollectionId: null,
            status: "processing",
            error: null,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: null,
            encodeProgress: 0,
          },
        ],
      }),
    );
    const bunny = fakeBunny({
      listVideos: mock(async () => [
        { guid: "orphan", status: 2, metaTags: [] },
      ]),
    });

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => twoVideos() }),
      bunny,
      store,
    }).runMigration();

    expect(state.id).not.toBe("migration-1");
    expect(bunny.setVideoMetadata).toHaveBeenCalledWith(
      "orphan",
      expect.objectContaining({ sourceId: "222" }),
      expect.any(AbortSignal),
    );
    // The other video is gone from Bunny, so it is fetched afresh.
    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(state.videoMigrations.map((m) => m.bunnyVideoId).sort()).toEqual([
      "bunny-1",
      "orphan",
    ]);
  });

  test("starts fresh when the saved run belongs to another source, library, or account", async () => {
    for (const saved of [
      savedState({ source: "s3" }),
      savedState({ bunnyLibraryId: "99999" }),
      savedState({ bunnyAccountId: "acct-other" }),
    ]) {
      const state = await service({
        adapter: fakeAdapter({ listContent: async () => twoVideos() }),
        store: memoryStore(saved).store,
      }).runMigration({ resume: true });
      expect(state.id).not.toBe("migration-1");
    }
  });
});

describe("state persistence", () => {
  test("writes status transitions through but coalesces encode-progress writes", async () => {
    const { store, saves } = memoryStore();
    const bunny = fakeBunny({
      waitForVideoProcessing: mock(async (_id, onProgress) => {
        for (let i = 0; i < 50; i++) onProgress?.(i * 2, 3);
        return { success: true };
      }),
    });

    await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny,
      store,
    }).runMigration({ wait: true });

    const statuses = saves.map((s) => s.videoMigrations[0]?.status);
    expect(statuses).toContain("fetching");
    expect(statuses).toContain("processing");
    expect(statuses.at(-1)).toBe("completed");
    expect(saves.length).toBeLessThan(20);
  });
});

describe("runPool", () => {
  test("keeps every slot busy and never exceeds the requested concurrency", async () => {
    let active = 0;
    let peak = 0;
    const order: number[] = [];

    // Item 0 is slow; a fixed-window batch loop would idle the other slots on it.
    await runPool([0, 1, 2, 3, 4, 5], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n === 0 ? 30 : 1));
      order.push(n);
      active--;
    });

    expect(peak).toBe(3);
    expect(order).toHaveLength(6);
    expect(order.at(-1)).toBe(0);

    const seen: number[] = [];
    await runPool([], 5, async () => {
      seen.push(0);
    });
    await runPool([1, 2], 99, async (n) => {
      seen.push(n);
    });
    expect(seen).toEqual([1, 2]);
  });
});
