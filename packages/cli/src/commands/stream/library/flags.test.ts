import { expect, test } from "bun:test";
import { librarySettingsFromFlags, librarySettingsWarnings } from "./flags.ts";

// The sparse body keeps an update from rewriting settings nobody mentioned; --no-jit arrives as false and must still be sent.
test("librarySettingsFromFlags sends only the fields that were passed", () => {
  expect(
    librarySettingsFromFlags({
      resolutions: "720p,1080p",
      jit: false,
      transcribingLanguages: "en, de",
    }),
  ).toEqual({
    EnabledResolutions: "720p,1080p",
    JitEncodingEnabled: false,
    TranscribingCaptionLanguages: ["en", "de"],
  });
});

test("librarySettingsFromFlags names the invalid codec values", () => {
  expect(() => librarySettingsFromFlags({ codecs: "X264,x264,divx" })).toThrow(
    /Invalid --codecs value\(s\): divx/,
  );
});

// The dashboard's Encoding page toggles, mapped one-to-one; --no- forms still send false.
test("librarySettingsFromFlags maps the encoding toggles", () => {
  expect(
    librarySettingsFromFlags({
      mp4Fallback: true,
      earlyPlay: false,
      keepOriginal: true,
      multiAudio: true,
    }),
  ).toEqual({
    EnableMP4Fallback: true,
    AllowEarlyPlay: false,
    KeepOriginalFiles: true,
    EnableMultiAudioTrackSupport: true,
  });
});

test("librarySettingsWarnings flags Early-Play exposure and refuses it without originals", () => {
  expect(librarySettingsWarnings({ earlyPlay: true })[0]).toContain(
    "publicly exposes",
  );
  expect(librarySettingsWarnings({ keepOriginal: false })[0]).toContain(
    "encode reencode",
  );
  expect(() =>
    librarySettingsWarnings({ earlyPlay: true, keepOriginal: false }),
  ).toThrow("can't be combined with --no-keep-original");
});
