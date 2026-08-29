import { expect, test } from "bun:test";
import prompts from "prompts";
import { uploadDestination } from "./upload.ts";

test("--to wins and is used verbatim, with a trailing slash meaning 'into this directory'", async () => {
  expect(await uploadDestination("./photo.png", "images/x.png", false)).toBe(
    "images/x.png",
  );
  expect(await uploadDestination("./photo.png", "images/", false)).toBe(
    "images/photo.png",
  );
});

test("no --to and no prompt uploads to the zone root under the file's name", async () => {
  expect(await uploadDestination("./dist/photo.png", undefined, false)).toBe(
    "photo.png",
  );
});

test("a blank answer means the zone root", async () => {
  prompts.inject([""]);
  expect(await uploadDestination("./photo.png", undefined, true)).toBe(
    "photo.png",
  );
});

test("an answered path is used", async () => {
  prompts.inject(["images/"]);
  expect(await uploadDestination("./photo.png", undefined, true)).toBe(
    "images/photo.png",
  );
});

// Cancelling must not fall through to the blank-means-root path and overwrite a root object.
// An injected Error is the library's cancel signal; injecting undefined yields the prompt's initial.
test("cancelling the prompt aborts instead of uploading to the root", async () => {
  prompts.inject([new Error("cancelled")]);
  expect(
    await uploadDestination("./photo.png", undefined, true),
  ).toBeUndefined();
});
