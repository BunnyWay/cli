import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

test("captionLanguage normalizes a language code", () => {
  expect(captionLanguage("EN")).toBe("en");
  expect(captionLanguage(" de ")).toBe("de");
  expect(captionLanguage("pt-BR")).toBe("pt-br");
  expect(captionLanguage("fil")).toBe("fil");
});

test("captionLanguage rejects something that is not a language code", () => {
  expect(() => captionLanguage("english")).toThrow(/Invalid language code/);
  expect(() => captionLanguage("e")).toThrow(/Invalid language code/);
  expect(() => captionLanguage("./en.vtt")).toThrow(/Invalid language code/);
});

test("readCaptionFile base64-encodes the file for the JSON body", async () => {
  const file = join(dir, "captions.vtt");
  await Bun.write(file, "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n");

  const encoded = await readCaptionFile(file);

  expect(Buffer.from(encoded, "base64").toString()).toContain("WEBVTT");
});

test("readCaptionFile accepts .srt too", async () => {
  const file = join(dir, "captions.srt");
  await Bun.write(file, "1\n00:00:00,000 --> 00:00:02,000\nHello\n");
  expect(await readCaptionFile(file)).toBeTruthy();
});

test("readCaptionFile rejects a missing file before any request", async () => {
  await expect(readCaptionFile(join(dir, "nope.vtt"))).rejects.toThrow(
    /Caption file not found/,
  );
});

test("readCaptionFile rejects a directory", async () => {
  const nested = join(dir, "subs");
  await mkdir(nested);
  await expect(readCaptionFile(nested)).rejects.toThrow(
    /is not a regular file/,
  );
});

// A video file here would be a silent, expensive mistake.
test("readCaptionFile rejects a file that is not a caption format", async () => {
  const file = join(dir, "clip.mp4");
  await Bun.write(file, "not captions");
  await expect(readCaptionFile(file)).rejects.toThrow(
    /does not look like a caption file/,
  );
});

test("readCaptionFile rejects an empty file", async () => {
  const file = join(dir, "empty.vtt");
  await Bun.write(file, "");
  await expect(readCaptionFile(file)).rejects.toThrow(/is empty/);
});
