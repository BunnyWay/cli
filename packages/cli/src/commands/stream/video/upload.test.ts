import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@/core/logger.ts";
import {
  isEmptyVideoShell,
  streamVideoUploadCommand,
  TUS_THRESHOLD_BYTES,
  uploadFileSize,
  uploadStrategy,
  videoTitle,
} from "./upload.ts";

const VIDEO_PATH = "/library/4321/videos/video-guid";
const originalFetch = globalThis.fetch;
const originalExit = process.exit;
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-upload-"));
  process.exit = ((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never;
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.exit = originalExit;
  (console.error as any).mockRestore();
  await rm(dir, { recursive: true, force: true });
});

// A blank --title would otherwise create an untitled video.
test("a blank title falls back to the file's name", () => {
  expect(videoTitle("./media/clip.mp4", "   ")).toBe("clip.mp4");
});

// A lost response does not mean the bytes were rejected, so only an untouched shell may be deleted.
test("isEmptyVideoShell allows cleanup only for Created and UploadFailed", () => {
  expect(isEmptyVideoShell(0)).toBe(true);
  expect(isEmptyVideoShell(6)).toBe(true);
  expect(isEmptyVideoShell(4)).toBe(false);
  expect(isEmptyVideoShell(undefined)).toBe(false);
});

test("uploadFileSize rejects a missing file or a directory before any API call", async () => {
  await expect(uploadFileSize(join(dir, "nope.mp4"))).rejects.toThrow(
    /File not found/,
  );
  const nested = join(dir, "videos");
  await mkdir(nested);
  await expect(uploadFileSize(nested)).rejects.toThrow(
    /is a directory, and upload takes a single video file/,
  );
});

test("uploadStrategy switches to resumable only above 2 GiB", () => {
  expect(uploadStrategy(TUS_THRESHOLD_BYTES)).toBe("put");
  expect(uploadStrategy(TUS_THRESHOLD_BYTES + 1)).toBe("tus");
});

/** Stub the core and Stream APIs with a failing PUT; returns every request as "METHOD path". */
function stubFailedUpload(statusRead: Response): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: Request) => {
    const { pathname } = new URL(input.url);
    seen.push(`${input.method} ${pathname}`);
    if (pathname.endsWith("/videolibrary/4321")) {
      return Response.json({ Id: 4321, Name: "lib", ApiKey: "library-key" });
    }
    if (input.method === "POST") {
      return Response.json({ guid: "video-guid", title: "clip.mp4" });
    }
    if (input.method === "PUT") {
      return Response.json({ message: "boom" }, { status: 500 });
    }
    if (input.method === "GET") return statusRead.clone();
    return Response.json({});
  }) as unknown as typeof fetch;
  return seen;
}

async function runUpload(): Promise<string[]> {
  const file = join(dir, "clip.mp4");
  await Bun.write(file, "video-bytes");
  const errors = spyOn(logger, "error").mockImplementation(() => {});
  try {
    await expect(
      streamVideoUploadCommand.handler({
        file,
        lib: "4321",
        apiKey: "account-key",
        profile: "default",
        output: "text",
      } as never),
    ).rejects.toThrow("exit 1");
    return errors.mock.calls.map(([msg]) => msg);
  } finally {
    errors.mockRestore();
  }
}

test("a failed upload deletes the video only after its status confirms an empty shell", async () => {
  const seen = stubFailedUpload(
    Response.json({ guid: "video-guid", status: 0 }),
  );
  const errors = await runUpload();
  expect(seen.slice(-2)).toEqual([`GET ${VIDEO_PATH}`, `DELETE ${VIDEO_PATH}`]);
  expect(errors[0]).toEndWith("failed: boom");
});

test("a failed upload keeps the video when its status cannot be read, and still reports the upload error", async () => {
  const seen = stubFailedUpload(Response.json({}, { status: 500 }));
  const errors = await runUpload();
  expect(seen).not.toContain(`DELETE ${VIDEO_PATH}`);
  expect(errors[0]).toEndWith("failed: boom");
});
