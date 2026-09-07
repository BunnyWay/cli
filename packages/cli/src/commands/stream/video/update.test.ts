import { expect, test } from "bun:test";
import prompts from "prompts";
import {
  nextVideoTitle,
  parseJsonArrayFlag,
  videoUpdateBody,
} from "./update.ts";

test("videoUpdateBody sends only the fields that were passed", () => {
  expect(videoUpdateBody({ title: " Launch demo " })).toEqual({
    title: "Launch demo",
  });
  expect(videoUpdateBody({ collection: "collection-guid" })).toEqual({
    collectionId: "collection-guid",
  });
  expect(videoUpdateBody({})).toEqual({});
});

// An empty --collection is how a video is taken out of its collection.
test("videoUpdateBody treats an empty --collection as a clear", () => {
  expect(videoUpdateBody({ collection: "" })).toEqual({ collectionId: "" });
  expect(videoUpdateBody({ collection: "  " })).toEqual({ collectionId: "" });
});

test("videoUpdateBody parses the chapters and moments arrays", () => {
  expect(
    videoUpdateBody({
      chapters: '[{"title":"Intro","start":0,"end":30}]',
      moments: '[{"label":"Demo","timestamp":42}]',
    }),
  ).toEqual({
    chapters: [{ title: "Intro", start: 0, end: 30 }],
    moments: [{ label: "Demo", timestamp: 42 }],
  });
});

test("videoUpdateBody accepts an empty array to clear chapters", () => {
  expect(videoUpdateBody({ chapters: "[]" })).toEqual({ chapters: [] });
});

test("parseJsonArrayFlag rejects malformed JSON before any request", () => {
  expect(() => parseJsonArrayFlag("chapters", "{not json")).toThrow(
    /--chapters is not valid JSON/,
  );
});

test("parseJsonArrayFlag requires an array of objects", () => {
  expect(() => parseJsonArrayFlag("chapters", '{"title":"Intro"}')).toThrow(
    /--chapters must be a JSON array/,
  );
  expect(() => parseJsonArrayFlag("moments", "null")).toThrow(
    /--moments must be a JSON array/,
  );
  expect(() => parseJsonArrayFlag("chapters", '["Intro"]')).toThrow(
    /--chapters must be an array of objects/,
  );
  expect(() => parseJsonArrayFlag("chapters", "[[]]")).toThrow(
    /--chapters must be an array of objects/,
  );
});

test("--title wins and is trimmed", async () => {
  expect(await nextVideoTitle("old", "  Launch demo  ", false)).toBe(
    "Launch demo",
  );
});

test("no --title and no way to prompt is an error, not a silent no-op", async () => {
  await expect(nextVideoTitle("old", undefined, false)).rejects.toThrow(
    "Nothing to update.",
  );
  await expect(nextVideoTitle("old", "   ", false)).rejects.toThrow(
    "Nothing to update.",
  );
});

test("an answered prompt provides the new title", async () => {
  prompts.inject(["Launch demo"]);
  expect(await nextVideoTitle("old", undefined, true)).toBe("Launch demo");
});

// Leaving the prefilled title alone must not be reported as a rename.
test("a blank answer leaves the title alone", async () => {
  prompts.inject([""]);
  expect(await nextVideoTitle("old", undefined, true)).toBeUndefined();
});

test("cancelling the prompt leaves the title alone", async () => {
  prompts.inject([new Error("cancelled")]);
  expect(await nextVideoTitle("old", undefined, true)).toBeUndefined();
});
