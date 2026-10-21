import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prompts from "prompts";
import { withTTY } from "@/commands/stream/test-tty.ts";
import { localFileArg, matchingFiles } from "./file-arg.ts";

const VIDEO = [".mp4", ".mov"];
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-file-arg-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("matchingFiles lists only files with a wanted extension, sorted, case-insensitively", async () => {
  await Bun.write(join(dir, "b.MOV"), "x");
  await Bun.write(join(dir, "a.mp4"), "x");
  await Bun.write(join(dir, "notes.txt"), "x");
  await mkdir(join(dir, "folder.mp4"));
  expect(matchingFiles(dir, VIDEO)).toEqual(["a.mp4", "b.MOV"]);
  expect(matchingFiles(join(dir, "missing"), VIDEO)).toEqual([]);
});

test("a given path is used as is, without prompting", async () => {
  expect(
    await localFileArg(" ./clip.mp4 ", {
      noun: "video file",
      extensions: VIDEO,
      usage: "bunny stream videos upload ./video.mp4",
    }),
  ).toBe("./clip.mp4");
});

// An unattended run can't answer a picker, so it must fail before any API call.
test("a missing path errors with usage when there is nobody to ask", async () => {
  await expect(
    localFileArg(undefined, {
      output: "json",
      noun: "video file",
      extensions: VIDEO,
      usage: "bunny stream videos upload ./video.mp4",
    }),
  ).rejects.toThrow("A video file is required.");
});

test("the picker offers files from the directory", async () => {
  await Bun.write(join(dir, "clip.mp4"), "x");
  prompts.inject(["clip.mp4"]);
  const file = await withTTY(() =>
    localFileArg(undefined, {
      noun: "video file",
      extensions: VIDEO,
      usage: "bunny stream videos upload ./video.mp4",
      dir,
    }),
  );
  expect(file).toBe(join(dir, "clip.mp4"));
});

test("with no matching files, the path is typed in", async () => {
  prompts.inject(["  ./elsewhere/clip.mp4 "]);
  const file = await withTTY(() =>
    localFileArg(undefined, {
      noun: "video file",
      extensions: VIDEO,
      usage: "bunny stream videos upload ./video.mp4",
      dir,
    }),
  );
  expect(file).toBe("./elsewhere/clip.mp4");
});

test("cancelling the prompt reports the file as required", async () => {
  prompts.inject([undefined]);
  await expect(
    withTTY(() =>
      localFileArg(undefined, {
        noun: "video file",
        extensions: VIDEO,
        usage: "bunny stream videos upload ./video.mp4",
        dir,
      }),
    ),
  ).rejects.toThrow("A video file is required.");
});
