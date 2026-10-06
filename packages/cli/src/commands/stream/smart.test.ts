import { expect, test } from "bun:test";
import type { UserError } from "@/core/errors.ts";
import { requireTranscript, smartGenerateBody } from "./smart.ts";
import type { VideoModel } from "./videos-api.ts";

const VIDEO = {
  videoLibraryId: 4321,
  guid: "video-guid",
  title: "clip.mp4",
  status: 4,
} as VideoModel;

// An all-false body bills nothing but reads as success; a source language alone is still nothing to generate.
test("smartGenerateBody requires at least one generation flag", () => {
  expect(() =>
    smartGenerateBody({ sourceLanguage: "en", title: false }),
  ).toThrow("Nothing to generate.");
});

// The API rejects a captionless video, so the CLI stops first and points at transcribe.
test("requireTranscript refuses a captionless video and names transcribe", () => {
  let error: UserError | undefined;
  try {
    requireTranscript(VIDEO);
  } catch (caught) {
    error = caught as UserError;
  }
  expect(error?.message).toBe(
    "clip.mp4 has no captions, and smart generation needs a transcript.",
  );
  expect(error?.hint).toContain("bunny stream transcribe video-guid");

  expect(() =>
    requireTranscript({
      ...VIDEO,
      captions: [{ srclang: "en", label: "English" }],
    }),
  ).not.toThrow();
});
