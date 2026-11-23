import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import {
  type CoreClient,
  createToolContext,
  type StreamClient,
} from "@/tools/context.ts";
import {
  assertLiveSettings,
  type LiveStreamModel,
  liveSettingsBody,
  streamLiveCreate,
  streamLiveGet,
  streamLiveIngest,
  streamLiveList,
  streamLiveRotateKey,
  streamLiveStatus,
  streamLiveUpdate,
  toLiveIngest,
  toLiveStream,
} from "./index.ts";

interface Call {
  method: string;
  path: string;
  params?: unknown;
  body?: unknown;
  headers?: unknown;
}

const MODEL: LiveStreamModel = {
  videoLibraryId: 12345,
  guid: "0f4e5d6c-0000-0000-0000-000000000001",
  title: "Keynote",
  public: true,
  status: 3,
  dateCreated: "2026-11-23T10:00:00Z",
  streamKey: "bunnylive_secretkey123456",
  playbackUrlHls: "https://vz-1.b-cdn.net/live/playlist.m3u8",
  dvrEnabled: true,
  dvrWindowSeconds: 3600,
  recordVod: true,
  streamType: 0,
  autoStartOnIngestDetected: false,
  availableResolutions: "1080p, 720p",
  outputs: [
    { endpoint: "rtmps://a.rtmp.youtube.com/live2", streamKey: "yt-key" },
  ],
  transcodingMessages: [
    {
      timeStamp: "2026-11-23T10:05:00Z",
      level: 2,
      issueCode: 20,
      message: "Failed over",
    },
  ],
};

/** A fake Stream client answering by "METHOD path", recording every call. */
function fakeStream(
  routes: Record<string, unknown | (() => unknown)>,
  calls: Call[],
): StreamClient {
  const handle =
    (method: string) =>
    (
      path: string,
      init: { params?: unknown; body?: unknown; headers?: unknown } = {},
    ) => {
      calls.push({ method, path, ...init });
      const route = routes[`${method} ${path}`];
      if (typeof route === "function") {
        try {
          return Promise.resolve({ data: route() });
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return Promise.resolve({ data: route });
    };
  return {
    GET: handle("GET"),
    POST: handle("POST"),
    PUT: handle("PUT"),
    PATCH: handle("PATCH"),
    DELETE: handle("DELETE"),
  } as unknown as StreamClient;
}

function setup(routes: Record<string, unknown | (() => unknown)>) {
  const calls: Call[] = [];
  const keys: string[] = [];
  const core = {
    GET: () =>
      Promise.resolve({
        data: { Id: 12345, Name: "my-library", ApiKey: "library-key" },
      }),
  } as unknown as CoreClient;
  const stream = fakeStream(routes, calls);
  const ctx = createToolContext({
    clients: {
      core,
      streamLibrary: (key: string) => {
        keys.push(key);
        return stream;
      },
    },
  });
  return { ctx, calls, keys };
}

test("toLiveStream normalizes the model and never carries a stream key", () => {
  const stream = toLiveStream(MODEL);
  expect(stream).toMatchObject({
    id: MODEL.guid,
    status: "preview",
    type: "event",
    dvr: { enabled: true, windowSeconds: 3600 },
    resolutions: ["1080p", "720p"],
    outputs: [
      { endpoint: "rtmps://a.rtmp.youtube.com/live2", hasStreamKey: true },
    ],
    issues: [
      {
        level: "warning",
        code: "LiveFailedOverToBackup",
        message: "Failed over",
      },
    ],
  });
  expect(JSON.stringify(stream)).not.toContain("secretkey");
  expect(JSON.stringify(stream)).not.toContain("yt-key");
});

test("toLiveIngest keeps only the protocols the API returned", () => {
  const ingest = toLiveIngest(12345, "abc", "key", {
    rtmps: {
      primaryIngestUrl: "rtmps://global.rtmp.mediadelivery.net/live",
      backupIngestUrl: null,
    },
    srt: null,
  });
  expect(ingest.rtmps).toEqual({
    primary: "rtmps://global.rtmp.mediadelivery.net/live",
    backup: null,
  });
  expect(ingest.rtmp).toBeNull();
  expect(ingest.srt).toBeNull();
});

test("assertLiveSettings rejects a recorded channel and an event over 12 hours", () => {
  expect(() =>
    assertLiveSettings({ type: "channel", recordVod: true }),
  ).toThrow("can't be recorded");
  expect(() =>
    assertLiveSettings({
      scheduledStart: "2026-12-01T00:00:00Z",
      scheduledEnd: "2026-12-01T13:00:00Z",
    }),
  ).toThrow("12 hours");
  expect(() =>
    assertLiveSettings({
      type: "channel",
      scheduledStart: "2026-12-01T00:00:00Z",
      scheduledEnd: "2026-12-03T00:00:00Z",
    }),
  ).not.toThrow();
});

test("liveSettingsBody maps a DVR window of 0 to DVR off and keeps nulls", () => {
  expect(liveSettingsBody({ dvrWindowSeconds: 0 })).toEqual({
    dvrEnabled: false,
  });
  expect(
    liveSettingsBody({ dvrWindowSeconds: 1800, scheduledEnd: null }),
  ).toEqual({
    dvrEnabled: true,
    dvrWindowSeconds: 1800,
    scheduledEndTime: null,
  });
});

test("stream.live.list pages until every stream is read, using the library's own key", async () => {
  const { ctx, calls, keys } = setup({
    "GET /library/{libraryId}/live": () => {
      const page = (calls.at(-1)?.params as { query: { page: number } }).query
        .page;
      return {
        totalItems: 2,
        items: page === 1 ? [MODEL] : [{ ...MODEL, guid: "second" }],
      };
    },
  });
  const streams = await streamLiveList.invoke(ctx, { library: 12345 });
  expect(streams.map((s) => s.id)).toEqual([MODEL.guid, "second"]);
  expect(keys).toEqual(["library-key"]);
});

test("stream.live.get names the stream on a 404", async () => {
  const { ctx } = setup({
    "GET /library/{libraryId}/live/{streamId}": () => {
      throw new ApiError("Not Found", 404);
    },
  });
  await expect(
    streamLiveGet.invoke(ctx, { library: 12345, stream: "missing" }),
  ).rejects.toThrow("Live stream missing not found.");
});

test("stream.live.create sends only given settings and rewords the concurrency limit", async () => {
  const { ctx, calls } = setup({
    "POST /library/{libraryId}/live": MODEL,
  });
  await streamLiveCreate.invoke(ctx, {
    library: 12345,
    title: "Keynote",
    type: "channel",
    autoStart: true,
  });
  expect(calls.at(-1)?.body).toEqual({
    title: "Keynote",
    public: true,
    streamType: 1,
    autoStartOnIngestDetected: true,
  });

  const limited = setup({
    "POST /library/{libraryId}/live": () => {
      throw new ApiError("Too many", 429);
    },
  });
  await expect(
    streamLiveCreate.invoke(limited.ctx, { library: 12345, title: "Again" }),
  ).rejects.toThrow("limit of concurrent live streams");
});

test("stream.live.update sends a merge patch and refuses an empty change", async () => {
  const { ctx, calls } = setup({
    "PATCH /library/{libraryId}/live/{streamId}": MODEL,
  });
  await streamLiveUpdate.invoke(ctx, {
    library: 12345,
    stream: MODEL.guid,
    title: "Renamed",
    scheduledEnd: null,
  });
  const call = calls.at(-1);
  expect(call?.body).toEqual({ title: "Renamed", scheduledEndTime: null });
  expect(call?.headers).toEqual({
    "Content-Type": "application/merge-patch+json",
  });

  await expect(
    streamLiveUpdate.invoke(ctx, { library: 12345, stream: MODEL.guid }),
  ).rejects.toThrow("No live stream changes requested.");
});

test("stream.live.ingest returns the key with the stream's endpoints", async () => {
  const { ctx } = setup({
    "GET /library/{libraryId}/live/{streamId}": {
      ...MODEL,
      ingestEndpoints: {
        srt: {
          primaryIngestUrl:
            "srt://global.srt.mediadelivery.net:8890?streamid=publish:live/bunnylive_secretkey123456",
        },
      },
    },
  });
  const ingest = await streamLiveIngest.invoke(ctx, {
    library: 12345,
    stream: MODEL.guid,
  });
  expect(ingest.streamKey).toBe("bunnylive_secretkey123456");
  expect(ingest.srt?.primary).toContain("publish:live/");
  expect(streamLiveIngest.sensitive).toBe(true);
});

test("stream.live.rotatekey re-reads the endpoints, since SRT URLs carry the key", async () => {
  const { ctx, calls } = setup({
    "PUT /library/{libraryId}/live/{streamId}/regenerate-key": {
      ...MODEL,
      streamKey: "bunnylive_newkey",
    },
    "GET /library/{libraryId}/live/ingest-endpoints": {
      rtmps: { primaryIngestUrl: "rtmps://global.rtmp.mediadelivery.net/live" },
    },
  });
  const ingest = await streamLiveRotateKey.invoke(ctx, {
    library: 12345,
    stream: MODEL.guid,
  });
  expect(ingest.streamKey).toBe("bunnylive_newkey");
  expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(
    "GET /library/{libraryId}/live/ingest-endpoints",
  );
  expect(streamLiveRotateKey.kind).toBe("destructive");
});

test("stream.live.status tolerates a missing bitrate sample", async () => {
  const { ctx } = setup({
    "GET /library/{libraryId}/live/{streamId}": MODEL,
    "GET /library/{libraryId}/live/{streamId}/status": {
      readyToStart: true,
      primaryLive: true,
      backupLive: false,
      lastPingAgo: 1200,
      duration: null,
    },
    "GET /library/{libraryId}/live/{streamId}/current-bitrate": () => {
      throw new ApiError("Not Found", 404);
    },
  });
  const report = await streamLiveStatus.invoke(ctx, {
    library: 12345,
    stream: MODEL.guid,
  });
  expect(report).toMatchObject({
    status: "preview",
    readyToStart: true,
    primaryLive: true,
    bitrateKbps: null,
    lastPingMs: 1200,
  });
});
