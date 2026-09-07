import { expect, test } from "bun:test";
import {
  encodingTierValue,
  hasLibrarySettingsFlags,
  librarySettingsFromFlags,
  parseChoiceCsv,
  parseCsvFlag,
} from "./flags.ts";

test("encodingTierValue maps the tier names to the API's integers", () => {
  expect(encodingTierValue("free")).toBe(0);
  expect(encodingTierValue("premium")).toBe(1);
  expect(encodingTierValue(" PREMIUM ")).toBe(1);
});

test("encodingTierValue rejects an unknown tier", () => {
  expect(() => encodingTierValue("gold")).toThrow(/Invalid --encoding-tier/);
});

test("parseCsvFlag trims and drops empty entries", () => {
  expect(parseCsvFlag(" en , de ,, fr ")).toEqual(["en", "de", "fr"]);
  expect(parseCsvFlag("")).toEqual([]);
});

test("parseChoiceCsv validates, lowercases, and dedupes", () => {
  expect(parseChoiceCsv("codecs", "X264, vp9, x264", ["x264", "vp9"])).toEqual([
    "x264",
    "vp9",
  ]);
});

test("parseChoiceCsv names the invalid values", () => {
  expect(() => parseChoiceCsv("codecs", "x264,mpeg2", ["x264", "vp9"])).toThrow(
    /Invalid --codecs value\(s\): mpeg2/,
  );
  expect(() => parseChoiceCsv("codecs", " , ", ["x264"])).toThrow(
    /--codecs needs at least one value/,
  );
});

// The sparse body is what keeps an update from rewriting settings nobody mentioned.
test("librarySettingsFromFlags sends only the fields that were passed", () => {
  expect(librarySettingsFromFlags({ resolutions: "720p,1080p" })).toEqual({
    EnabledResolutions: "720p,1080p",
  });
  expect(librarySettingsFromFlags({})).toEqual({});
});

test("librarySettingsFromFlags maps every encoding flag", () => {
  expect(
    librarySettingsFromFlags({
      name: "  my-library  ",
      encodingTier: "premium",
      jit: true,
      codecs: "x264,vp9",
      resolutions: "240p,720p",
    }),
  ).toEqual({
    Name: "my-library",
    EncodingTier: 1,
    JitEncodingEnabled: true,
    OutputCodecs: "x264,vp9",
    EnabledResolutions: "240p,720p",
  });
});

test("librarySettingsFromFlags maps every transcribing flag", () => {
  expect(
    librarySettingsFromFlags({
      transcribing: true,
      transcribingLanguages: "en, de",
      transcribingTitle: true,
      transcribingDescription: false,
      transcribingChapters: true,
      transcribingMoments: false,
    }),
  ).toEqual({
    EnableTranscribing: true,
    // The spec types this as an array of languages, not a CSV string.
    TranscribingCaptionLanguages: ["en", "de"],
    EnableTranscribingTitleGeneration: true,
    EnableTranscribingDescriptionGeneration: false,
    EnableTranscribingChaptersGeneration: true,
    EnableTranscribingMomentsGeneration: false,
  });
});

// --no-jit / --no-transcribing arrive as false, which must still be sent.
test("librarySettingsFromFlags keeps an explicit false", () => {
  expect(librarySettingsFromFlags({ jit: false, transcribing: false })).toEqual(
    {
      JitEncodingEnabled: false,
      EnableTranscribing: false,
    },
  );
});

test("librarySettingsFromFlags rejects an empty language list", () => {
  expect(() =>
    librarySettingsFromFlags({ transcribingLanguages: " , " }),
  ).toThrow(/--transcribing-languages needs at least one language/);
});

test("librarySettingsFromFlags rejects invalid resolutions and codecs", () => {
  expect(() => librarySettingsFromFlags({ resolutions: "720p,4k" })).toThrow(
    /Invalid --resolutions value\(s\): 4k/,
  );
  expect(() => librarySettingsFromFlags({ codecs: "x264,divx" })).toThrow(
    /Invalid --codecs value\(s\): divx/,
  );
});

test("hasLibrarySettingsFlags ignores the name, which create takes positionally", () => {
  expect(hasLibrarySettingsFlags({ name: "x" })).toBe(false);
  expect(hasLibrarySettingsFlags({ jit: false })).toBe(true);
  expect(hasLibrarySettingsFlags({ transcribingMoments: true })).toBe(true);
  expect(hasLibrarySettingsFlags({})).toBe(false);
});
