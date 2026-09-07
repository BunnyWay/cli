import { expect, test } from "bun:test";
import type { UserError } from "@/core/errors.ts";
import {
  hasNoCaptions,
  requireTranscript,
  smartGenerateBody,
} from "./smart.ts";
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

// Smart generation reads an existing transcript and never makes one, so a
// missing captions list is a hard precondition.
test("hasNoCaptions covers every empty shape the API returns", () => {
  expect(hasNoCaptions(VIDEO)).toBe(true);
  expect(hasNoCaptions({ ...VIDEO, captions: [] })).toBe(true);
  expect(hasNoCaptions({ ...VIDEO, captions: null })).toBe(true);
  expect(hasNoCaptions({ ...VIDEO, captions: undefined })).toBe(true);
});

test("hasNoCaptions is false once captions exist", () => {
  expect(
    hasNoCaptions({
      ...VIDEO,
      captions: [{ srclang: "en", label: "English" }],
    }),
  ).toBe(false);
});

// The API rejects a captionless video outright, so the CLI stops first and
// points at the command that produces the transcript.
test("requireTranscript refuses a captionless video and names transcribe", () => {
  expect(() => requireTranscript(VIDEO)).toThrow(
    "clip.mp4 has no captions, and smart generation needs a transcript.",
  );

  let hint: string | undefined;
  try {
    requireTranscript(VIDEO);
  } catch (error) {
    hint = (error as UserError).hint;
  }
  expect(hint).toContain("bunny stream transcribe video-guid");
});

test("requireTranscript passes a video that already has captions", () => {
  expect(() =>
    requireTranscript({
      ...VIDEO,
      captions: [{ srclang: "en", label: "English" }],
    }),
  ).not.toThrow();
});
