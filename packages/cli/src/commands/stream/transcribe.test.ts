import { expect, test } from "bun:test";
import { transcribeSettings } from "./transcribe.ts";

test("transcribeSettings is empty when nothing was asked for", () => {
  // An empty body is valid: the library's transcribing defaults apply.
  expect(transcribeSettings({})).toEqual({});
});

test("transcribeSettings parses the language list into an array", () => {
  expect(transcribeSettings({ languages: " en , de ,, fr " })).toEqual({
    targetLanguages: ["en", "de", "fr"],
  });
});

test("transcribeSettings drops an empty language list rather than sending []", () => {
  expect(transcribeSettings({ languages: " , " })).toEqual({});
});

test("transcribeSettings maps the source language and generation flags", () => {
  expect(
    transcribeSettings({
      sourceLanguage: " en ",
      generateTitle: true,
      generateDescription: false,
      generateChapters: true,
      generateMoments: false,
    }),
  ).toEqual({
    sourceLanguage: "en",
    generateTitle: true,
    generateDescription: false,
    generateChapters: true,
    generateMoments: false,
  });
});
