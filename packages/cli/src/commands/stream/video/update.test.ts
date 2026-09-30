import { expect, test } from "bun:test";
import prompts from "prompts";
import {
  nextVideoTitle,
  parseJsonArrayFlag,
  videoUpdateBody,
} from "./update.ts";

// An empty --collection is how a video is taken out of its collection.
test("videoUpdateBody treats an empty --collection as a clear", () => {
  expect(videoUpdateBody({ collection: "  " })).toEqual({ collectionId: "" });
});

// A malformed body would otherwise clear the field server side.
test("parseJsonArrayFlag rejects anything but an array of objects", () => {
  expect(() => parseJsonArrayFlag("chapters", "{not json")).toThrow(
    /--chapters is not valid JSON/,
  );
  expect(() => parseJsonArrayFlag("chapters", '["Intro"]')).toThrow(
    /--chapters must be an array of objects/,
  );
});

test("no --title and no way to prompt is an error, not a silent no-op", async () => {
  await expect(nextVideoTitle("old", "   ", false)).rejects.toThrow(
    "Nothing to update.",
  );
});

// Leaving the prompt blank or cancelling it must not be reported as a rename.
test("a blank or cancelled prompt leaves the title alone", async () => {
  prompts.inject(["", new Error("cancelled")]);
  expect(await nextVideoTitle("old", undefined, true)).toBeUndefined();
  expect(await nextVideoTitle("old", undefined, true)).toBeUndefined();
});
