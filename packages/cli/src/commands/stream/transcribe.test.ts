import { expect, test } from "bun:test";
import { transcribeSettings } from "./transcribe.ts";

// An empty list must fall back to the library defaults rather than send [].
test("transcribeSettings drops an empty language list rather than sending []", () => {
  expect(transcribeSettings({ languages: " en ,, de " })).toEqual({
    targetLanguages: ["en", "de"],
  });
  expect(transcribeSettings({ languages: " , " })).toEqual({});
});
