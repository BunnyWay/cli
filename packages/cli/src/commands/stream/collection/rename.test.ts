import { expect, test } from "bun:test";
import prompts from "prompts";
import { nextCollectionName } from "./rename.ts";

test("--name wins and is trimmed", async () => {
  expect(await nextCollectionName("old", "  Tutorials  ", false)).toBe(
    "Tutorials",
  );
});

test("no --name and no way to prompt is an error", async () => {
  await expect(nextCollectionName("old", undefined, false)).rejects.toThrow(
    "Nothing to rename.",
  );
  await expect(nextCollectionName("old", "   ", false)).rejects.toThrow(
    "Nothing to rename.",
  );
});

test("an answered prompt provides the new name", async () => {
  prompts.inject(["Tutorials"]);
  expect(await nextCollectionName("old", undefined, true)).toBe("Tutorials");
});

test("a blank answer or a cancel leaves the name alone", async () => {
  prompts.inject([""]);
  expect(await nextCollectionName("old", undefined, true)).toBeUndefined();
  prompts.inject([new Error("cancelled")]);
  expect(await nextCollectionName("old", undefined, true)).toBeUndefined();
});
