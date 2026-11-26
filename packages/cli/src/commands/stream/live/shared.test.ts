import { expect, test } from "bun:test";
import { toLiveStream } from "@/tools/stream/index.ts";
import { nextSteps, startFact } from "./create.ts";
import {
  formatPingAgo,
  liveSettingsFromFlags,
  maskIngest,
  maskSrtUrl,
  parseDuration,
  parseRestream,
  parseTimeFlag,
  restreamEnv,
  streamRef,
} from "./shared.ts";
import { statusHint } from "./status.ts";

const NOW = Date.parse("2026-11-23T12:00:00Z");

test("parseDuration takes seconds or a unit suffix", () => {
  expect(parseDuration("90", "dvr")).toBe(90);
  expect(parseDuration("30m", "dvr")).toBe(1800);
  expect(parseDuration("2h", "dvr")).toBe(7200);
  expect(parseDuration("1.5h", "dvr")).toBe(5400);
  expect(() => parseDuration("soon", "dvr")).toThrow('Invalid --dvr "soon"');
});

test("parseDuration combines units, largest first", () => {
  // 10h5m is the documented --expires maximum, so it must parse.
  expect(parseDuration("10h5m", "expires")).toBe(36_300);
  expect(parseDuration("10h05m", "expires")).toBe(36_300);
  expect(parseDuration("1h30m", "dvr")).toBe(5400);
  expect(parseDuration("1h 30m", "dvr")).toBe(5400);
  expect(parseDuration("30 m", "dvr")).toBe(1800);
  expect(parseDuration("1d2h3m4s", "dvr")).toBe(93_784);
  for (const bad of ["5m10h", "1h1h", "1h30", "h", "-1h", ""]) {
    expect(() => parseDuration(bad, "dvr")).toThrow(`Invalid --dvr "${bad}"`);
  }
});

test("parseTimeFlag takes ISO 8601 or a time from now", () => {
  expect(parseTimeFlag("+30m", "start", NOW)).toBe("2026-11-23T12:30:00.000Z");
  expect(parseTimeFlag("2026-12-01T18:00:00Z", "start", NOW)).toBe(
    "2026-12-01T18:00:00.000Z",
  );
  expect(parseTimeFlag("+1h30m", "start", NOW)).toBe(
    "2026-11-23T13:30:00.000Z",
  );
  expect(() => parseTimeFlag("tomorrow", "start", NOW)).toThrow(
    'Invalid --start "tomorrow"',
  );
});

test("parseTimeFlag reads a date-time without an offset as UTC, whatever the local zone", () => {
  // The flags say "ISO 8601 UTC"; Date alone would read this as local time.
  expect(parseTimeFlag("2026-12-01T18:00", "start", NOW)).toBe(
    "2026-12-01T18:00:00.000Z",
  );
  expect(parseTimeFlag("2026-12-01T18:00:00.5", "start", NOW)).toBe(
    "2026-12-01T18:00:00.500Z",
  );
  // An explicit offset is honoured.
  expect(parseTimeFlag("2026-12-01T18:00:00-05:00", "start", NOW)).toBe(
    "2026-12-01T23:00:00.000Z",
  );
});

test("parseRestream splits the stream key off the last path segment", () => {
  expect(parseRestream("rtmps://a.rtmp.youtube.com/live2/abcd-1234")).toEqual({
    endpoint: "rtmps://a.rtmp.youtube.com/live2",
    streamKey: "abcd-1234",
  });
  expect(() => parseRestream("https://example.com/live/key")).toThrow(
    "Invalid --restream",
  );
  expect(() => parseRestream("rtmp://example.com")).toThrow(
    "Invalid --restream",
  );
});

test("a bad --restream value is echoed with its key masked", () => {
  expect(() => parseRestream("https://example.com/live/secret-key")).toThrow(
    'Invalid --restream "https://example.com/live/•••".',
  );
  expect(() => parseRestream("secret-key")).toThrow(
    'Invalid --restream "•••".',
  );
});

test("liveSettingsFromFlags builds a sparse create body", () => {
  expect(
    liveSettingsFromFlags(
      {
        type: "event",
        record: true,
        dvr: "1h",
        start: "+30m",
        restream: ["rtmp://live.twitch.tv/app/live_123"],
      },
      "create",
      NOW,
    ),
  ).toEqual({
    type: "event",
    recordVod: true,
    dvrWindowSeconds: 3600,
    scheduledStart: "2026-11-23T12:30:00.000Z",
    outputs: [
      {
        endpoint: "rtmp://live.twitch.tv/app",
        streamKeyEnv: "BUNNY_STREAM_RESTREAM_KEY_1",
      },
    ],
  });
});

test("restream keys go to the environment, never into the settings", () => {
  const args = {
    restream: [
      "rtmp://live.twitch.tv/app/live_123",
      "rtmps://a.rtmp.youtube.com/live2/yt-key",
    ],
  };
  const settings = liveSettingsFromFlags(args, "create", NOW);
  expect(JSON.stringify(settings)).not.toContain("live_123");
  expect(JSON.stringify(settings)).not.toContain("yt-key");
  expect(restreamEnv(args, "create")).toEqual({
    BUNNY_STREAM_RESTREAM_KEY_1: "live_123",
    BUNNY_STREAM_RESTREAM_KEY_2: "yt-key",
  });
  expect(restreamEnv({ restream: ["none"] }, "update")).toEqual({});
  expect(restreamEnv({}, "update")).toEqual({});
});

test('liveSettingsFromFlags treats "none" as clearing on update only', () => {
  expect(
    liveSettingsFromFlags(
      { start: "none", trailer: "none", restream: ["none"] },
      "update",
      NOW,
    ),
  ).toEqual({ scheduledStart: null, trailerVideoId: null, outputs: [] });
});

test("liveSettingsFromFlags rejects bad combinations before any request", () => {
  expect(() =>
    liveSettingsFromFlags({ type: "channel", record: true }, "create", NOW),
  ).toThrow("can't be recorded");
  expect(() => liveSettingsFromFlags({ dvr: "13h" }, "create", NOW)).toThrow(
    "at most 12h",
  );
  expect(() =>
    liveSettingsFromFlags({ start: "2020-01-01T00:00:00Z" }, "create", NOW),
  ).toThrow("must be in the future");
});

test("maskIngest hides the key, including inside SRT URLs", () => {
  const key = "bunnylive_secretkey123456";
  const srt = `srt://global.srt.mediadelivery.net:8890?mode=caller&streamid=publish:live/${key}&latency=120000`;
  expect(maskSrtUrl(srt)).not.toContain("secretkey");
  expect(maskSrtUrl(srt)).toContain("3456&latency=120000");

  const masked = maskIngest({
    libraryId: 1,
    streamId: "abc",
    streamKey: key,
    rtmp: null,
    rtmps: {
      primary: "rtmps://global.rtmp.mediadelivery.net/live",
      backup: null,
    },
    srt: { primary: srt, backup: null },
  });
  expect(JSON.stringify(masked)).not.toContain("secretkey");
  expect(masked.rtmps?.primary).toBe(
    "rtmps://global.rtmp.mediadelivery.net/live",
  );
});

test("next steps name the library unless it's the linked one", () => {
  // nextSteps reads the ID, auto-start and the scheduled start.
  const stream = toLiveStream({
    videoLibraryId: 12345,
    guid: "abc",
    title: "Keynote",
    autoStartOnIngestDetected: false,
  } as Parameters<typeof toLiveStream>[0]);
  expect(nextSteps(stream)).toContain(
    "Go live:          bunny stream live start abc",
  );
  const ref = streamRef("abc", 12345);
  expect(ref).toBe("abc --lib 12345");
  expect(nextSteps(stream, ref)).toContain(
    "Go live:          bunny stream live start abc --lib 12345",
  );
  expect(nextSteps(stream, ref)).toContain(
    "Reveal the key:   bunny stream live ingest abc --lib 12345 --show-secret",
  );
});

// A scheduled stream goes live by itself; the summary and steps must not say it waits for `live start`.
test("startFact and nextSteps describe how the stream goes live", () => {
  const base = {
    videoLibraryId: 12345,
    guid: "abc",
    title: "Keynote",
    autoStartOnIngestDetected: false,
  } as Parameters<typeof toLiveStream>[0];

  const manual = toLiveStream(base);
  expect(startFact(manual)).toBe("starts when you run `live start`");

  const auto = toLiveStream({ ...base, autoStartOnIngestDetected: true });
  expect(startFact(auto)).toBe("starts when the encoder connects");

  const scheduled = toLiveStream({
    ...base,
    scheduledStartTime: "2026-12-01T18:00:00",
  });
  expect(startFact(scheduled)).toMatch(/^starts by itself at Dec 0?1, 2026 /);
  expect(startFact(scheduled)).not.toContain("live start");
  const steps = nextSteps(scheduled);
  expect(
    steps.some((step) => step.startsWith("Go live:          automatic at")),
  ).toBe(true);
  expect(steps).toContain("Go live early:    bunny stream live start abc");
  expect(steps).not.toContain("Go live:          bunny stream live start abc");
});

test("status hints carry the stream reference", () => {
  const report = {
    id: "abc",
    status: "created",
    readyToStart: false,
  } as Parameters<typeof statusHint>[0];
  expect(statusHint(report)).toBe(
    "Waiting for the encoder. Settings: bunny stream live ingest abc",
  );
  expect(statusHint(report, "abc --lib 12345")).toBe(
    "Waiting for the encoder. Settings: bunny stream live ingest abc --lib 12345",
  );
});

test("formatPingAgo reads seconds while recent, then the largest unit", () => {
  expect(formatPingAgo(null)).toBe("-");
  expect(formatPingAgo(1200)).toBe("1s ago");
  expect(formatPingAgo(45_000)).toBe("45s ago");
  expect(formatPingAgo(125_000)).toBe("2m ago");
  expect(formatPingAgo(584_184_000)).toBe("6d ago");
});
