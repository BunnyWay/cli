import { expect, test } from "bun:test";
import type { UserError } from "@/core/errors.ts";
import { smartGenerateBody } from "./smart.ts";
import {
  captionlessError,
  hasCaptions,
  offerTranscription,
  smartTranscriptionEstimate,
  transcribeSettingsForSmart,
} from "./smart-transcribe.ts";
import type { VideoModel } from "./videos-api.ts";

const VIDEO = {
  videoLibraryId: 4321,
  guid: "video-guid",
  title: "clip.mp4",
  status: 4,
  length: 720,
} as VideoModel;

const LIBRARY = { TranscribingCaptionLanguages: ["de", "fr"] };

// An all-false body bills nothing but reads as success; a source language alone is still nothing to generate.
test("smartGenerateBody requires at least one generation flag", () => {
  expect(() =>
    smartGenerateBody({ sourceLanguage: "en", title: false }),
  ).toThrow("Nothing to generate.");
});

test("hasCaptions tells a transcribed video from a captionless one", () => {
  expect(hasCaptions(VIDEO)).toBe(false);
  expect(
    hasCaptions({ ...VIDEO, captions: [{ srclang: "en", label: "English" }] }),
  ).toBe(true);
});

// Transcribing with the same generate flags produces the same fields, so one request does both.
test("transcribeSettingsForSmart carries the generate flags and source language", () => {
  expect(
    transcribeSettingsForSmart({
      generateTitle: true,
      generateChapters: true,
      sourceLanguage: "en",
    }),
  ).toEqual({
    generateTitle: true,
    generateChapters: true,
    sourceLanguage: "en",
  });
});

// The estimate bills the library's default output languages; the source transcript is free.
test("smartTranscriptionEstimate uses the library's output languages", () => {
  expect(smartTranscriptionEstimate(VIDEO, LIBRARY)).toEqual({
    minutes: 12,
    languages: ["de", "fr"],
    cost: 2.4,
  });
});

// Unattended runs can't approve a charge, so they stop with the cost and the opt-in flag.
test("captionlessError names the cost and the --transcribe opt-in", () => {
  const error = captionlessError(
    VIDEO,
    smartTranscriptionEstimate(VIDEO, LIBRARY),
  ) as UserError;
  expect(error.message).toContain(
    "clip.mp4 has no captions, and smart generation needs a transcript.",
  );
  expect(error.message).toContain(
    "About $2.40 for 2 output languages (de, fr)",
  );
  expect(error.hint).toContain("--transcribe");
});

test("offerTranscription errors unattended without --transcribe", async () => {
  await expect(
    offerTranscription(
      VIDEO,
      LIBRARY,
      { generateTitle: true },
      { output: "json" },
    ),
  ).rejects.toThrow("smart generation needs a transcript");
});

// --transcribe pre-approves the charge, so nothing is prompted.
test("offerTranscription returns the transcribe settings with --transcribe", async () => {
  expect(
    await offerTranscription(
      VIDEO,
      LIBRARY,
      { generateTitle: true },
      { output: "json", transcribe: true },
    ),
  ).toEqual({ generateTitle: true });
});
