import { expect, test } from "bun:test";
import { librarySettingsFromFlags } from "./flags.ts";

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
