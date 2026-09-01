import { expect, test } from "bun:test";
import type { StreamClient, VideoModel } from "../videos-api.ts";
import { resolveVideoInteractive } from "./interactive.ts";

const VIDEO = {
  videoLibraryId: 4321,
  guid: "video-guid",
  title: "clip.mp4",
  status: 4,
} as VideoModel;

function fakeStreamClient(paths: string[]): StreamClient {
  return {
    GET: async (path: string, init?: any) => {
      paths.push(path);
      if (path === "/library/{libraryId}/videos/{videoId}") {
        return {
          data: init?.params?.path?.videoId === VIDEO.guid ? VIDEO : undefined,
        };
      }
      if (path === "/library/{libraryId}/videos") {
        return { data: { totalItems: 1, items: [VIDEO] } };
      }
      throw new Error(`unexpected GET ${path}`);
    },
  } as unknown as StreamClient;
}

// `bun test` has no TTY, so every case here takes the unattended path.
test("an explicit GUID is fetched directly, with no listing", async () => {
  const paths: string[] = [];

  const video = await resolveVideoInteractive(
    fakeStreamClient(paths),
    4321,
    "video-guid",
  );

  expect(video.title).toBe("clip.mp4");
  expect(paths).toEqual(["/library/{libraryId}/videos/{videoId}"]);
});

test("an unknown GUID reports the video as missing", async () => {
  await expect(
    resolveVideoInteractive(fakeStreamClient([]), 4321, "nope"),
  ).rejects.toThrow("Video nope not found.");
});

test("no GUID and no way to prompt errors instead of listing videos", async () => {
  const paths: string[] = [];

  await expect(
    resolveVideoInteractive(fakeStreamClient(paths), 4321, undefined),
  ).rejects.toThrow("A video is required.");
  expect(paths).toEqual([]);
});

// --force must not let a destructive command delete a video the user never named.
test("force refuses to pick a video even when it could prompt", async () => {
  const paths: string[] = [];

  await expect(
    resolveVideoInteractive(fakeStreamClient(paths), 4321, undefined, {
      force: true,
    }),
  ).rejects.toThrow("A video is required.");
  expect(paths).toEqual([]);
});

test("force still resolves an explicit GUID", async () => {
  const video = await resolveVideoInteractive(
    fakeStreamClient([]),
    4321,
    "video-guid",
    { force: true },
  );
  expect(video.guid).toBe("video-guid");
});

test("the missing-video error points at the listing command", async () => {
  try {
    await resolveVideoInteractive(fakeStreamClient([]), 4321, undefined, {
      output: "json",
    });
    throw new Error("expected a UserError");
  } catch (err) {
    expect((err as { hint?: string }).hint).toContain(
      "bunny stream videos list",
    );
  }
});
