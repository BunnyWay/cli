import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captionLanguage, readCaptionFile } from "./add.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-caption-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Swapped positionals would otherwise send a file path as the srclang path segment.
test("captionLanguage normalizes a code and rejects a path", () => {
  expect(captionLanguage(" pt-BR ")).toBe("pt-br");
  expect(() => captionLanguage("./en.vtt")).toThrow(/Invalid language code/);
});

test("readCaptionFile base64-encodes the file for the JSON body", async () => {
  const file = join(dir, "captions.vtt");
  await Bun.write(file, "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n");

  const encoded = await readCaptionFile(file);

  expect(Buffer.from(encoded, "base64").toString()).toContain("WEBVTT");
});

// A video file here would be a silent, expensive mistake.
test("readCaptionFile rejects a file that is not a caption format", async () => {
  const file = join(dir, "clip.mp4");
  await Bun.write(file, "not captions");
  await expect(readCaptionFile(file)).rejects.toThrow(
    /does not look like a caption file/,
  );
});
