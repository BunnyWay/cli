import { expect, test } from "bun:test";
import prompts from "prompts";
import { nextVideoTitle } from "./update.ts";

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
