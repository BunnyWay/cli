import { expect, test } from "bun:test";
import {
  captionLanguages,
  resolveSmartSource,
  spokenLanguage,
} from "./smart-source.ts";

test("captionLanguages lists each caption code once, in order", () => {
  expect(
    captionLanguages({
      captions: [
        { srclang: "en-auto", label: "English (auto)" },
        { srclang: "de", label: "German" },
        { srclang: "EN-AUTO", label: "dup" },
        { srclang: null, label: "broken" },
      ],
    }),
  ).toEqual(["en-auto", "de"]);
});

// The bug: `en` was sent unchanged, but transcription labels its track `en-auto`.
test("a plain code falls back to its -auto track when that's all there is", () => {
  expect(resolveSmartSource(["en-auto", "de"], "en")).toEqual({
    language: "en-auto",
    reason: "matched",
  });
  expect(resolveSmartSource(["en", "de"], "en-auto")).toEqual({
    language: "en",
    reason: "matched",
  });
});

test("an exact track wins over its -auto twin", () => {
  expect(resolveSmartSource(["en", "en-auto"], "EN")).toEqual({
    language: "en",
    reason: "exact",
  });
});

test("a language with no track is refused, naming the tracks and the -auto label", () => {
  expect(() => resolveSmartSource(["en-auto"], "fr")).toThrow(
    "This video has no fr captions.",
  );
  try {
    resolveSmartSource(["en-auto"], "fr");
  } catch (err) {
    expect((err as { hint?: string }).hint).toContain("Available: en-auto.");
    expect((err as { hint?: string }).hint).toContain("<code>-auto");
  }
});

// Without --source-language the API would take the first track; prefer the transcript instead.
test("with no request, one track or one -auto transcript is picked", () => {
  expect(resolveSmartSource(["de"])).toEqual({
    language: "de",
    reason: "only",
  });
  expect(resolveSmartSource(["de", "en-auto", "fr"])).toEqual({
    language: "en-auto",
    reason: "auto",
  });
});

test("with no request and no single transcript, the caller has to choose", () => {
  expect(resolveSmartSource(["en-auto", "de-auto", "fr"])).toEqual({
    choose: ["en-auto", "de-auto"],
  });
  expect(resolveSmartSource(["de", "fr"])).toEqual({ choose: ["de", "fr"] });
});

// On a captionless video the value means the spoken language, so the suffix goes.
test("spokenLanguage drops the -auto suffix", () => {
  expect(spokenLanguage("en-auto")).toBe("en");
  expect(spokenLanguage(" de ")).toBe("de");
  expect(spokenLanguage(undefined)).toBeUndefined();
});
