import { describe, expect, mock, test } from "bun:test";
import type { BunnyStream } from "./bunny-stream.ts";
import type { BunnyVideo } from "./bunny-types.ts";
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
    ...overrides,
  } as unknown as BunnyStream;
}

function service(opts: {
  adapter?: SourceAdapter;
  bunny?: BunnyStream;
  store?: StateStore;
}) {
  return new MigrationService({
    adapter: opts.adapter ?? fakeAdapter(),
    bunny: opts.bunny ?? fakeBunny(),
    store: opts.store ?? memoryStore().store,
    logger: silentLogger,
    libraryId: "12345",
    label: "Vimeo",
    pollIntervalMs: 1,
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
      { guid: "b1", metaTags: [{ property: "vimeoId", value: "111" }] },
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
  test("fetches, tags with the dedup property plus sanitized metadata, and returns with it queued", async () => {
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
    }).runMigration();

    expect(bunny.setVideoMetadata).toHaveBeenCalledWith("bunny-1", {
      sourceId: "111",
      sourceIdProperty: "vimeoId",
      description: "Summer trip",
      tags: ["beach", "2024"],
    });
    expect(state.status).toBe("in_progress");
    expect(state.videoMigrations[0]).toMatchObject({
      status: "processing",
      bunnyVideoId: "bunny-1",
    });
  });

  test("re-imports a video whose Bunny copy failed, and adopts one still encoding", async () => {
    const tagged = (guid: string, value: string, status: number) => ({
      guid,
      status,
      encodeProgress: 30,
      metaTags: [{ property: "vimeoId", value }],
    });
    const bunny = fakeBunny({
      listVideos: mock(async () => [
        tagged("broken", "111", 5),
        tagged("busy", "222", 3),
      ]),
    });
    const svc = service({
      adapter: fakeAdapter({
        listContent: async () =>
          content({
            uncategorizedVideos: [
              { sourceId: "111", displayName: "Broken", folderId: null },
              { sourceId: "222", displayName: "Busy", folderId: null },
            ],
          }),
      }),
      bunny,
    });

    const summary = await svc.getSummary();
    expect(summary).toMatchObject({
      newVideos: 1,
      failedOnBunny: 1,
      alreadyMigrated: 1,
      processingOnBunny: 1,
    });

    const state = await svc.runMigration();
    expect(bunny.fetchVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(
      state.videoMigrations.map((m) => [m.bunnyVideoId, m.status]),
    ).toEqual([
      ["bunny-1", "processing"],
      ["busy", "processing"],
    ]);
  });

  test("skips a video the dedup index already knows about", async () => {
    const bunny = fakeBunny({
      listVideos: mock(async () => [
        { guid: "existing", metaTags: [{ property: "vimeoId", value: "111" }] },
      ]),
    });

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny,
    }).runMigration();

    expect(bunny.fetchVideoFromUrl).not.toHaveBeenCalled();
    expect(state.videoMigrations[0]?.bunnyVideoId).toBe("existing");
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
    }).runMigration({ concurrency: 1 });

    expect(state.status).toBe("failed");
    expect(state.videoMigrations.map((m) => m.status)).toEqual([
      "processing",
      "failed",
    ]);
  });

  test("fails a video whose handoff exceeds the per-video timeout without swallowing it", async () => {
    const bunny = fakeBunny({
      setVideoMetadata: mock(() => new Promise(() => {})),
    });

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny,
    }).runMigration({ migrationTimeoutMs: 20 });

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
        status: "failed",
        error: "Bunny could not fetch the file from the source",
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

  test("resumes a failed run, retrying the failed video and leaving the finished one", async () => {
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
    const bunny = fakeBunny({
      listVideos: mock(async () => [{ guid: "orphan-guid", status: 3 }]),
    });
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
    expect(bunny.setVideoMetadata).toHaveBeenCalledWith("orphan-guid", {
      sourceId: "222",
      sourceIdProperty: "vimeoId",
    });
  });

  test("starts fresh when the saved run belongs to another source or library", async () => {
    for (const saved of [
      savedState({ source: "s3" }),
      savedState({ bunnyLibraryId: "99999" }),
    ]) {
      const state = await service({
        adapter: fakeAdapter({ listContent: async () => twoVideos() }),
        store: memoryStore(saved).store,
      }).runMigration({ resume: true });
      expect(state.id).not.toBe("migration-1");
    }
  });
});

describe("wait", () => {
  test("polls the library until Bunny finishes, coalescing progress writes", async () => {
    const { store, saves } = memoryStore();
    const encoding = (progress: number, status: number): BunnyVideo[] =>
      [{ guid: "bunny-1", status, encodeProgress: progress }] as BunnyVideo[];
    const listVideos = mock(async (): Promise<BunnyVideo[]> => [])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(encoding(50, 3))
      .mockResolvedValueOnce(encoding(100, 4));
    const phases: string[] = [];

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny: fakeBunny({ listVideos }),
      store,
    }).runMigration({ wait: true, onProgress: (_s, p) => phases.push(p) });

    expect(state.status).toBe("completed");
    expect(listVideos).toHaveBeenCalledTimes(3);
    expect(phases).toContain("encode");
    const statuses = saves.map((s) => s.videoMigrations[0]?.status);
    expect(statuses).toContain("fetching");
    expect(statuses.at(-1)).toBe("completed");
  });

  test("a plain re-run keeps tracking videos the last run left processing", async () => {
    const queued: MigrationState = {
      id: "migration-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "vimeo",
      bunnyLibraryId: "12345",
      folderMappings: [],
      videoMigrations: [
        {
          sourceVideoId: "111",
          videoName: "Holiday",
          sourceFolderId: null,
          bunnyVideoId: "untagged",
          bunnyCollectionId: null,
          status: "processing",
          error: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: null,
          encodeProgress: 0,
        },
      ],
      status: "in_progress",
    };
    const bunny = fakeBunny({
      listVideos: mock(async () => [{ guid: "untagged", status: 3 }]),
    });

    const state = await service({
      adapter: fakeAdapter({ listContent: async () => oneVideo() }),
      bunny,
      store: memoryStore(queued).store,
    }).runMigration();

    expect(state.id).not.toBe("migration-1");
    expect(bunny.fetchVideoFromUrl).not.toHaveBeenCalled();
    expect(bunny.setVideoMetadata).toHaveBeenCalledWith("untagged", {
      sourceId: "111",
      sourceIdProperty: "vimeoId",
    });
    expect(state.videoMigrations[0]?.status).toBe("processing");
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
