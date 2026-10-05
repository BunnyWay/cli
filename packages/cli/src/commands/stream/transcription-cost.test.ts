import { expect, test } from "bun:test";
import {
  estimateTranscription,
  formatTranscriptionEstimate,
  outputLanguages,
} from "./transcription-cost.ts";

test("outputLanguages prefers the requested languages over library defaults", () => {
  expect(outputLanguages(["DE", "fr", "de"], ["es"])).toEqual(["de", "fr"]);
  expect(outputLanguages(undefined, ["es", "it"])).toEqual(["es", "it"]);
  expect(outputLanguages([], null)).toEqual([]);
});

// minutes (rounded up) × output languages × $0.10
test("estimateTranscription multiplies by every output language", () => {
  expect(estimateTranscription(721, ["de", "fr", "es"])).toEqual({
    minutes: 13,
    languages: ["de", "fr", "es"],
    cost: 3.9,
  });
});

// Only output languages are billed; the source-language transcript is free.
test("estimateTranscription with no output languages costs nothing", () => {
  const estimate = estimateTranscription(600, []);
  expect(estimate.cost).toBe(0);
  expect(formatTranscriptionEstimate(estimate)).toBe(
    "Source-language captions only — no charge.",
  );
});

test("formatTranscriptionEstimate names the languages and the length", () => {
  expect(
    formatTranscriptionEstimate(estimateTranscription(720, ["de", "fr"])),
  ).toBe(
    "About $2.40 for 2 output languages (de, fr) on a 12 min video ($0.10 per output language-minute).",
  );
  expect(
    formatTranscriptionEstimate(estimateTranscription(0, ["de"])),
  ).toContain("the video's length isn't known yet");
});
