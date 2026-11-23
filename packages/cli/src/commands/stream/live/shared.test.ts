import { expect, test } from "bun:test";
import {
  liveSettingsFromFlags,
  maskIngest,
  maskSrtUrl,
  parseDuration,
  parseRestream,
  parseTimeFlag,
} from "./shared.ts";

const NOW = Date.parse("2026-11-23T12:00:00Z");

test("parseDuration takes seconds or a unit suffix", () => {
  expect(parseDuration("90", "dvr")).toBe(90);
  expect(parseDuration("30m", "dvr")).toBe(1800);
  expect(parseDuration("2h", "dvr")).toBe(7200);
  expect(parseDuration("1.5h", "dvr")).toBe(5400);
  expect(() => parseDuration("soon", "dvr")).toThrow('Invalid --dvr "soon"');
});

test("parseTimeFlag takes ISO 8601 or a time from now", () => {
  expect(parseTimeFlag("+30m", "start", NOW)).toBe("2026-11-23T12:30:00.000Z");
  expect(parseTimeFlag("2026-12-01T18:00:00Z", "start", NOW)).toBe(
    "2026-12-01T18:00:00.000Z",
  );
  expect(() => parseTimeFlag("tomorrow", "start", NOW)).toThrow(
    'Invalid --start "tomorrow"',
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
    outputs: [{ endpoint: "rtmp://live.twitch.tv/app", streamKey: "live_123" }],
  });
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
