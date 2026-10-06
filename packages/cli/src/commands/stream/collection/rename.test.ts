import { expect, test } from "bun:test";
import prompts from "prompts";
import { nextCollectionName } from "./rename.ts";

test("no --name and no way to prompt is an error", async () => {
  await expect(nextCollectionName("old", undefined, false)).rejects.toThrow(
    "Nothing to rename.",
  );
});

test("a blank answer or a cancel leaves the name alone", async () => {
  prompts.inject([""]);
  expect(await nextCollectionName("old", undefined, true)).toBeUndefined();
  prompts.inject([new Error("cancelled")]);
  expect(await nextCollectionName("old", undefined, true)).toBeUndefined();
});
