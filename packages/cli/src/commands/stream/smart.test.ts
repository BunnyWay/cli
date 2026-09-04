import { expect, test } from "bun:test";
import { needsTranscription, smartGenerateBody } from "./smart.ts";
import type { VideoModel } from "./videos-api.ts";

const VIDEO = {
  videoLibraryId: 4321,
  guid: "video-guid",
  title: "clip.mp4",
  status: 4,
} as VideoModel;

test("smartGenerateBody maps each generation flag", () => {
  expect(smartGenerateBody({ title: true, moments: true })).toEqual({
    generateTitle: true,
    generateMoments: true,
  });
  expect(smartGenerateBody({ description: true, chapters: true })).toEqual({
    generateDescription: true,
    generateChapters: true,
  });
});

test("smartGenerateBody carries the source language when given", () => {
  expect(smartGenerateBody({ title: true, sourceLanguage: " en " })).toEqual({
    generateTitle: true,
    sourceLanguage: "en",
  });
});

// An all-false body bills nothing but reads as success, so it is refused.
test("smartGenerateBody requires at least one generation flag", () => {
  expect(() => smartGenerateBody({})).toThrow("Nothing to generate.");
  expect(() => smartGenerateBody({ sourceLanguage: "en" })).toThrow(
    "Nothing to generate.",
  );
  expect(() => smartGenerateBody({ title: false })).toThrow(
    "Nothing to generate.",
  );
});

// The billing guard: smart generation reads a transcript, so a video without
// captions gets transcribed first, which is metered.
test("needsTranscription is true when the video has no captions", () => {
  expect(needsTranscription(VIDEO)).toBe(true);
  expect(needsTranscription({ ...VIDEO, captions: [] })).toBe(true);
  expect(needsTranscription({ ...VIDEO, captions: null })).toBe(true);
});

test("needsTranscription is false once captions exist", () => {
  expect(
    needsTranscription({
      ...VIDEO,
      captions: [{ srclang: "en", label: "English" }],
    }),
  ).toBe(false);
});

// The billing gate needs a real answer, so an unattended run must be told to
// pass --force rather than silently accepting the charge.
test("the gate is only skipped for a video that already has captions", () => {
  const withCaptions = {
    ...VIDEO,
    captions: [{ srclang: "en", label: "English" }],
  };
  expect(needsTranscription(withCaptions)).toBe(false);
  expect(needsTranscription({ ...VIDEO, captions: undefined })).toBe(true);
});
