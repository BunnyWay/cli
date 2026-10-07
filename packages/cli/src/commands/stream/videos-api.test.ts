import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedConfig } from "@/config/index.ts";
import { UserError } from "@/core/errors.ts";
import type { VideoLibraryModel } from "./api.ts";
import {
  connectStreamLibrary,
  createVideo,
  fetchVideo,
  fetchVideos,
  formatDuration,
  queueVideoFetch,
  type StreamClient,
  setVideoThumbnail,
  uploadVideoFile,
  type VideoModel,
} from "./videos-api.ts";

const CONFIG: ResolvedConfig = {
  apiKey: "account-key",
  apiUrl: "https://api.bunny.net",
  profile: "default",
};

const LIBRARY: VideoLibraryModel = {
  Id: 4321,
  Name: "my-library",
  ApiKey: "library-key",
};

const VIDEO = {
  videoLibraryId: 4321,
  guid: "video-guid",
  title: "clip.mp4",
  status: 1,
} as VideoModel;

/** Paginated listing fake; records the page of every request. */
function listClient(
  pages: number[],
  videos: VideoModel[],
  opts: { pageSize: number; totalItems?: number },
): StreamClient {
  return {
    GET: async (_path: string, init?: any) => {
      const page = init?.params?.query?.page ?? 1;
      pages.push(page);
      const start = (page - 1) * opts.pageSize;
      return {
        data: {
          totalItems: opts.totalItems,
          itemsPerPage: opts.pageSize,
          items: videos.slice(start, start + opts.pageSize),
        },
      };
    },
  } as unknown as StreamClient;
}

const VIDEOS = ["a", "b", "c", "d", "e"].map((guid) => ({ ...VIDEO, guid }));

let dir = "";
let file = "";
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-"));
  file = join(dir, "clip.mp4");
  await Bun.write(file, "video-bytes");
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
});

test("connectStreamLibrary requires the library's own API key", () => {
  expect(() =>
    connectStreamLibrary({ ...LIBRARY, ApiKey: undefined }, { config: CONFIG }),
  ).toThrow(/No API key available for video library my-library/);
});

test("connectStreamLibrary targets the Stream host with the library key", async () => {
  let request: Request | undefined;
  globalThis.fetch = (async (input: Request) => {
    request = input;
    return Response.json(VIDEO);
  }) as unknown as typeof fetch;

  await fetchVideo(
    connectStreamLibrary(LIBRARY, { config: CONFIG }),
    4321,
    "video-guid",
  );

  expect(request?.url).toBe(
    "https://video.bunnycdn.com/library/4321/videos/video-guid",
  );
  expect(request?.headers.get("AccessKey")).toBe("library-key");
});

test("createVideo fails loudly when no video comes back", async () => {
  const client = {
    POST: async () => ({ data: undefined }),
  } as unknown as StreamClient;
  await expect(createVideo(client, 4321, "clip.mp4")).rejects.toThrow(
    'Creating the video "clip.mp4" did not return a video ID.',
  );
});

// totalItems is a ceiling: reaching it stops the drain even on a full page.
test("fetchVideos stops at the reported total without another request", async () => {
  const pages: number[] = [];
  const videos = await fetchVideos(
    listClient(pages, VIDEOS, { pageSize: 2, totalItems: 2 }),
    4321,
  );
  expect(videos).toHaveLength(2);
  expect(pages).toEqual([1]);
});

test("fetchVideos stops on an empty page even if totalItems over-reports", async () => {
  const pages: number[] = [];
  const videos = await fetchVideos(
    listClient(pages, VIDEOS.slice(0, 2), { pageSize: 2, totalItems: 99 }),
    4321,
  );
  expect(videos).toHaveLength(2);
  expect(pages).toEqual([1, 2]);
});

// The fake reports a page size of 2 while 100 was asked for, so this also covers a clamping server.
test("fetchVideos drains on page fullness when totalItems is absent", async () => {
  const pages: number[] = [];
  const videos = await fetchVideos(
    listClient(pages, VIDEOS, { pageSize: 2 }),
    4321,
  );
  expect(videos.map((video) => video.guid)).toEqual(["a", "b", "c", "d", "e"]);
  expect(pages).toEqual([1, 2, 3]);
});

// This endpoint answers 200 with success: false for a URL it would not accept.
test("queueVideoFetch turns a failed status into a user-facing error", async () => {
  const client = {
    POST: async () => ({ data: { success: false, message: "Invalid URL" } }),
  } as unknown as StreamClient;
  await expect(
    queueVideoFetch(client, 4321, { url: "https://example.com/nope" }),
  ).rejects.toThrow(
    "bunny.net could not fetch https://example.com/nope: Invalid URL",
  );
});

test("uploadVideoFile sends the file's bytes as application/octet-stream", async () => {
  let request: Request | undefined;
  globalThis.fetch = (async (input: Request) => {
    request = input;
    return Response.json({ success: true });
  }) as unknown as typeof fetch;

  const client = connectStreamLibrary(LIBRARY, { config: CONFIG });
  await uploadVideoFile(client, 4321, "video-guid", file);

  expect(request?.method).toBe("PUT");
  expect(request?.headers.get("content-type")).toBe("application/octet-stream");
  expect(await request?.text()).toBe("video-bytes");
});

test("uploadVideoFile prefixes a thrown error or an error body as a UserError", async () => {
  const thrown = {
    PUT: async () => {
      throw new TypeError("fetch failed");
    },
  } as unknown as StreamClient;
  const returned = {
    PUT: async () => ({ error: { message: "already uploaded" } }),
  } as unknown as StreamClient;

  for (const [client, reason] of [
    [thrown, "fetch failed"],
    [returned, "already uploaded"],
  ] as const) {
    const err = await uploadVideoFile(client, 4321, "v", file).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toBe(`Uploading ${file} failed: ${reason}`);
  }
});

test("formatDuration rolls over to hours, rounds, and dashes nonsense", () => {
  expect(formatDuration(3725)).toBe("1:02:05");
  expect(formatDuration(59.6)).toBe("1:00");
  expect(formatDuration(Number.NaN)).toBe("—");
});

// Without the identity serializer openapi-fetch would JSON-encode the image.
test("setVideoThumbnail uploads a file as an untouched octet-stream body", async () => {
  let init: any;
  const client = {
    POST: async (_path: string, options: any) => {
      init = options;
      return { data: { success: true } };
    },
  } as unknown as StreamClient;

  await setVideoThumbnail(client, 4321, "video-guid", { file });

  expect(init.headers).toEqual({ "Content-Type": "application/octet-stream" });
  expect(init.bodySerializer(init.body)).toBe(init.body);
  expect(init.body.size).toBe("video-bytes".length);
});
