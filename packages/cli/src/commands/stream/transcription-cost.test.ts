import { expect, test } from "bun:test";
import {
  autoTranscriptionPending,
  estimateTranscription,
  formatTranscriptionEstimate,
  outputLanguages,
} from "./transcription-cost.ts";

test("outputLanguages prefers the requested languages over library defaults", () => {
  expect(outputLanguages(["DE", "fr", "de"], ["es"])).toEqual(["de", "fr"]);
  expect(outputLanguages(undefined, ["es", "it"])).toEqual(["es", "it"]);
  expect(outputLanguages([], null)).toEqual([]);
});

// The source-language transcript is billed like any other language, and only once.
test("a known source language is billed once, even when it is also a target", () => {
  const englishToEnglish = estimateTranscription(780, ["en"], "EN");
  expect(englishToEnglish).toEqual({
    minutes: 13,
    languages: ["en"],
    sourceDetected: false,
    cost: { min: 1.3, max: 1.3 },
  });
  expect(formatTranscriptionEstimate(englishToEnglish)).toBe(
    "About $1.30 for 1 language (en, including the en source transcript) on a 13 min video ($0.10 per language-minute).",
  );

  expect(estimateTranscription(780, ["de", "fr"], "en").cost).toEqual({
    min: 3.9,
    max: 3.9,
  });
});

// With the spoken language auto-detected, it may or may not match a target: a range.
test("an auto-detected source gives a range, from targets only to targets plus one", () => {
  const estimate = estimateTranscription(721, ["de", "fr", "es"]);
  expect(estimate).toEqual({
    minutes: 13,
    languages: ["de", "fr", "es"],
    sourceDetected: true,
    cost: { min: 3.9, max: 5.2 },
  });
  expect(formatTranscriptionEstimate(estimate)).toBe(
    "About $3.90–$5.20 for de, fr, es plus the auto-detected source language on a 13 min video ($0.10 per language-minute; the lower figure applies if the spoken language is one of these).",
  );
});

// No targets still produces (and bills) the source-language transcript.
test("a transcription with no targets bills the source transcript", () => {
  const estimate = estimateTranscription(600, []);
  expect(estimate.cost).toEqual({ min: 1, max: 1 });
  expect(formatTranscriptionEstimate(estimate)).toBe(
    "About $1.00 for the source-language transcript on a 10 min video ($0.10 per language-minute).",
  );
});

test("an unknown length still names the rate and the languages", () => {
  expect(formatTranscriptionEstimate(estimateTranscription(0, ["de"]))).toBe(
    "Billed at $0.10 per language-minute for de plus the auto-detected source language; the video's length isn't known yet.",
  );
});

// Right after an upload or re-encode, a transcribing library transcribes on its own.
test("autoTranscriptionPending is true only while a transcribing library is still encoding", () => {
  expect(
    autoTranscriptionPending({ EnableTranscribing: true }, { status: 3 }),
  ).toBe(true);
  expect(
    autoTranscriptionPending({ EnableTranscribing: true }, { status: 4 }),
  ).toBe(false);
  expect(
    autoTranscriptionPending({ EnableTranscribing: false }, { status: 3 }),
  ).toBe(false);
});
