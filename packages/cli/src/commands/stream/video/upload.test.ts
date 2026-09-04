import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isEmptyVideoShell,
  TUS_THRESHOLD_BYTES,
  uploadFileSize,
  uploadStrategy,
  videoTitle,
} from "./upload.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-upload-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("the title defaults to the file's name", () => {
  expect(videoTitle("./media/launch demo.mp4")).toBe("launch demo.mp4");
  expect(videoTitle("/abs/path/clip.mp4", undefined)).toBe("clip.mp4");
});

test("an explicit title wins, trimmed", () => {
  expect(videoTitle("./clip.mp4", "  Launch demo  ")).toBe("Launch demo");
});

// A blank --title would otherwise create an untitled video.
test("a blank title falls back to the file's name", () => {
  expect(videoTitle("./clip.mp4", "   ")).toBe("clip.mp4");
});

// The cleanup guard: only a video that never received bytes may be deleted after
// a failed upload, because a lost response does not mean the bytes were rejected.
test("isEmptyVideoShell allows cleanup only for Created and UploadFailed", () => {
  expect(isEmptyVideoShell(0)).toBe(true); // Created
  expect(isEmptyVideoShell(6)).toBe(true); // UploadFailed
});

test("isEmptyVideoShell keeps a video that may hold bytes", () => {
  for (const status of [1, 2, 3, 4, 5, 7, 8]) {
    expect(isEmptyVideoShell(status)).toBe(false);
  }
  // An unknown status is ambiguous, so it is never deleted.
  expect(isEmptyVideoShell(undefined)).toBe(false);
  expect(isEmptyVideoShell(99)).toBe(false);
});

test("uploadFileSize returns the byte size of a regular file", async () => {
  const file = join(dir, "clip.mp4");
  await Bun.write(file, "video-bytes");
  expect(await uploadFileSize(file)).toBe("video-bytes".length);
});

test("uploadFileSize rejects a missing file", async () => {
  await expect(uploadFileSize(join(dir, "nope.mp4"))).rejects.toThrow(
    /File not found/,
  );
});

test("uploadFileSize rejects a directory with a targeted message", async () => {
  const nested = join(dir, "videos");
  await mkdir(nested);
  await expect(uploadFileSize(nested)).rejects.toThrow(
    /is a directory, and upload takes a single video file/,
  );
});

// stat follows symlinks, so a link to a real file is uploadable as its target.
test("uploadFileSize follows a symlink to a file", async () => {
  const file = join(dir, "clip.mp4");
  await Bun.write(file, "video-bytes");
  const link = join(dir, "link.mp4");
  await symlink(file, link);
  expect(await uploadFileSize(link)).toBe("video-bytes".length);
});

// The 2 GiB switch, checked arithmetically so no test needs a huge file.
test("uploadStrategy keeps a single PUT up to and including 2 GiB", () => {
  expect(TUS_THRESHOLD_BYTES).toBe(2 * 1024 ** 3);
  expect(uploadStrategy(0)).toBe("put");
  expect(uploadStrategy(1)).toBe("put");
  expect(uploadStrategy(500 * 1024 ** 2)).toBe("put");
  expect(uploadStrategy(TUS_THRESHOLD_BYTES - 1)).toBe("put");
  expect(uploadStrategy(TUS_THRESHOLD_BYTES)).toBe("put");
});

test("uploadStrategy switches to resumable above 2 GiB", () => {
  expect(uploadStrategy(TUS_THRESHOLD_BYTES + 1)).toBe("tus");
  expect(uploadStrategy(5 * 1024 ** 3)).toBe("tus");
  expect(uploadStrategy(80 * 1024 ** 3)).toBe("tus");
});
