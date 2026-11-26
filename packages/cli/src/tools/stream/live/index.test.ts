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
  streamLiveStop,
  streamLiveThumbnailRemove,
  streamLiveUpdate,
  toLiveIngest,
  toLiveStream,
  toSamples,
  utcTimestamp,
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

// The Live API sends UTC times without an offset; Date would read them as local time.
test("utcTimestamp marks offset-less API times as UTC and leaves the rest alone", () => {
  expect(utcTimestamp("2026-11-26T20:00:00")).toBe("2026-11-26T20:00:00Z");
  expect(utcTimestamp("2026-11-26T16:18:51.118")).toBe(
    "2026-11-26T16:18:51.118Z",
  );
  expect(utcTimestamp("2026-11-26T20:00")).toBe("2026-11-26T20:00Z");
  expect(utcTimestamp("2026-11-26T20:00:00Z")).toBe("2026-11-26T20:00:00Z");
  expect(utcTimestamp("2026-11-26T16:21:33.0068664Z")).toBe(
    "2026-11-26T16:21:33.0068664Z",
  );
  expect(utcTimestamp("2026-11-26T20:00:00+01:00")).toBe(
    "2026-11-26T20:00:00+01:00",
  );
  expect(utcTimestamp("2026-11-26")).toBe("2026-11-26");
  expect(utcTimestamp(null)).toBeNull();
  expect(utcTimestamp(undefined)).toBeNull();
  expect(utcTimestamp("")).toBeNull();
});

test("toLiveStream and toSamples return API times as UTC", () => {
  const stream = toLiveStream({
    ...MODEL,
    dateCreated: "2026-11-26T16:18:51.118",
    scheduledStartTime: "2026-11-26T20:00:00",
    scheduledEndTime: "2026-11-26T22:00:00",
    startedAt: "2026-11-26T20:00:05.5",
    endedAt: "2026-11-26T21:00:00",
    transcodingMessages: [
      { timeStamp: "2026-11-26T20:30:00", level: 2, issueCode: 20 },
    ],
  });
  expect(stream).toMatchObject({
    createdAt: "2026-11-26T16:18:51.118Z",
    scheduledStart: "2026-11-26T20:00:00Z",
    scheduledEnd: "2026-11-26T22:00:00Z",
    startedAt: "2026-11-26T20:00:05.5Z",
    endedAt: "2026-11-26T21:00:00Z",
  });
  expect(stream.issues[0]?.time).toBe("2026-11-26T20:30:00Z");
  expect(Date.parse(stream.scheduledStart ?? "")).toBe(
    Date.UTC(2026, 10, 26, 20, 0, 0),
  );
  expect(toSamples([{ dateTime: "2026-11-26T20:00:10", value: 3000 }])).toEqual(
    [{ time: "2026-11-26T20:00:10Z", kbps: 3000 }],
  );
});

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

test("toLiveIngest reads the auto-create key from the SRT URL for RTMP(S) encoders", () => {
  const srt =
    "srt://global.srt.mediadelivery.net:8890?mode=caller&streamid=publish:live/auto%2Dkey123&latency=120000";
  const ingest = toLiveIngest(12345, null, null, {
    rtmps: {
      primaryIngestUrl: "rtmps://global.rtmp.mediadelivery.net/live",
      backupIngestUrl: null,
    },
    srt: { primaryIngestUrl: srt, backupIngestUrl: null },
  });
  expect(ingest.streamKey).toBe("auto-key123");
  // A per-stream ingest never borrows the key from SRT, and no SRT means no key.
  expect(
    toLiveIngest(12345, "abc", null, { srt: { primaryIngestUrl: srt } })
      .streamKey,
  ).toBeNull();
  expect(toLiveIngest(12345, null, null, { srt: null }).streamKey).toBeNull();
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

test("liveSettingsBody reads restream keys from the environment and names missing ones", () => {
  const outputs = [
    {
      endpoint: "rtmps://a.rtmp.youtube.com/live2",
      streamKeyEnv: "YOUTUBE_STREAM_KEY",
    },
  ];
  expect(
    liveSettingsBody({ outputs }, { YOUTUBE_STREAM_KEY: "yt-key" }),
  ).toEqual({
    outputs: [
      { endpoint: "rtmps://a.rtmp.youtube.com/live2", streamKey: "yt-key" },
    ],
  });
  expect(() => liveSettingsBody({ outputs }, {})).toThrow(
    "Missing restream stream key: YOUTUBE_STREAM_KEY.",
  );
  expect(liveSettingsBody({ outputs: [] })).toEqual({ outputs: [] });
});

test("stream.live.create takes no restream key as input", () => {
  expect(() =>
    streamLiveCreate.schema.parse({
      library: 12345,
      title: "Simulcast",
      outputs: [
        { endpoint: "rtmps://a.rtmp.youtube.com/live2", streamKey: "yt-key" },
      ],
    }),
  ).toThrow();
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

// The preview API wraps the stop response in a StatusModel envelope.
test("stream.live.stop reads the stream from a { data } envelope or a bare model", async () => {
  const ended = { ...MODEL, status: 5 };
  for (const answer of [
    { data: ended, success: true, statusCode: 200 },
    ended,
  ]) {
    const { ctx } = setup({
      "PUT /library/{libraryId}/live/{streamId}/stop": answer,
    });
    const stream = await streamLiveStop.invoke(ctx, {
      library: 12345,
      stream: MODEL.guid,
    });
    expect(stream).toMatchObject({
      id: MODEL.guid,
      title: "Keynote",
      status: "ended",
    });
  }
});

test("stream.live.stop refuses a response with no live stream in it", async () => {
  const { ctx } = setup({
    "PUT /library/{libraryId}/live/{streamId}/stop": {
      success: true,
      statusCode: 200,
    },
  });
  await expect(
    streamLiveStop.invoke(ctx, { library: 12345, stream: MODEL.guid }),
  ).rejects.toThrow("The API returned no live stream after stopping it.");
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

test("stream.live.rotatekey keeps the new key when the endpoints can't be read back", async () => {
  const { ctx } = setup({
    "PUT /library/{libraryId}/live/{streamId}/regenerate-key": {
      ...MODEL,
      streamKey: "bunnylive_newkey",
      ingestEndpoints: {
        rtmps: {
          primaryIngestUrl: "rtmps://global.rtmp.mediadelivery.net/live",
        },
        srt: { primaryIngestUrl: "srt://old?streamid=publish:live/oldkey" },
      },
    },
    "GET /library/{libraryId}/live/ingest-endpoints": () => {
      throw new ApiError("Bad Gateway", 502);
    },
  });
  const ingest = await streamLiveRotateKey.invoke(ctx, {
    library: 12345,
    stream: MODEL.guid,
  });
  expect(ingest.streamKey).toBe("bunnylive_newkey");
  expect(ingest.rtmps?.primary).toBe(
    "rtmps://global.rtmp.mediadelivery.net/live",
  );
  expect(ingest.srt).toBeNull();
  expect(ingest.warning).toContain("couldn't be read back");
});

test("stream.live.thumbnail.remove tells a missing thumbnail from a missing stream", async () => {
  const notFound = () => {
    throw new ApiError("Not Found", 404);
  };
  const noThumbnail = setup({
    "DELETE /library/{libraryId}/live/{streamId}/thumbnail": notFound,
    "GET /library/{libraryId}/live/{streamId}": MODEL,
  });
  await expect(
    streamLiveThumbnailRemove.invoke(noThumbnail.ctx, {
      library: 12345,
      stream: MODEL.guid,
    }),
  ).rejects.toThrow("has no custom thumbnail to remove");

  const noStream = setup({
    "DELETE /library/{libraryId}/live/{streamId}/thumbnail": notFound,
    "GET /library/{libraryId}/live/{streamId}": notFound,
  });
  await expect(
    streamLiveThumbnailRemove.invoke(noStream.ctx, {
      library: 12345,
      stream: MODEL.guid,
    }),
  ).rejects.toThrow(`Live stream ${MODEL.guid} not found.`);
});
