import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import {
  type CoreClient,
  createToolContext,
  type StreamClient,
} from "@/tools/context.ts";
import {
  streamVideoStorage,
  streamVideosList,
  toVideoStorage,
} from "./index.ts";

const LIBRARY = { Id: 12345, Name: "lib", ApiKey: "library-key" };

/** Fake core and Stream clients answering by "METHOD path". */
type Init = { params?: { query?: { page?: number } } };

function setup(routes: Record<string, unknown | ((init: Init) => unknown)>) {
  const answer =
    (method: string) =>
    (path: string, init: Init = {}) => {
      if (method === "GET" && path === "/videolibrary/{id}")
        return Promise.resolve({ data: LIBRARY });
      if (method === "GET" && path === "/user")
        return Promise.resolve({ data: { AccountId: "acc" } });
      const route = routes[`${method} ${path}`];
      if (typeof route !== "function") return Promise.resolve({ data: route });
      try {
        return Promise.resolve({ data: route(init) });
      } catch (err) {
        return Promise.reject(err);
      }
    };
  const client = {
    GET: answer("GET"),
    POST: answer("POST"),
    PUT: answer("PUT"),
    DELETE: answer("DELETE"),
  };
  const ctx = createToolContext({
    clients: {
      core: client as unknown as CoreClient,
      streamLibrary: () => client as unknown as StreamClient,
    },
  });
  return { ctx };
}

test("toVideoStorage totals renditions and parts, largest rendition first", () => {
  const storage = toVideoStorage(1, "v", {
    encoded: {
      "720p-h264": { codec: "h264", resolution: "720p", size: 100 },
      "1080p-av1": { codec: "av1", resolution: "1080p", size: 300 },
    },
    originals: 1000,
    mp4Fallback: 50,
    thumbnails: 5,
    previews: 10,
    miscellaneous: 2,
  });
  expect(storage.totalBytes).toBe(1467);
  expect(storage.renditions.map((r) => r.codec)).toEqual(["av1", "h264"]);
});

test("stream.videos.storage reads the status envelope and names a missing video", async () => {
  const { ctx } = setup({
    "GET /library/{libraryId}/videos/{videoId}": { title: "Launch demo" },
    "GET /library/{libraryId}/videos/{videoId}/storage": {
      success: true,
      data: { originals: 10 },
    },
  });
  const storage = await streamVideoStorage.invoke(ctx, {
    library: 12345,
    video: "v",
  });
  expect(storage.originalBytes).toBe(10);
  expect(storage.title).toBe("Launch demo");

  const missing = setup({
    "GET /library/{libraryId}/videos/{videoId}/storage": () => {
      throw new ApiError("Not Found", 404);
    },
  });
  await expect(
    streamVideoStorage.invoke(missing.ctx, { library: 12345, video: "v" }),
  ).rejects.toThrow("Video v not found.");
});

test("stream.videos.storage refuses a failed status envelope instead of reporting zero bytes", async () => {
  const failed = setup({
    "GET /library/{libraryId}/videos/{videoId}/storage": {
      success: false,
      message: "Storage size is still being calculated.",
      data: null,
    },
  });
  await expect(
    streamVideoStorage.invoke(failed.ctx, { library: 12345, video: "v" }),
  ).rejects.toThrow("Storage size is still being calculated.");

  const empty = setup({
    "GET /library/{libraryId}/videos/{videoId}/storage": { success: true },
  });
  await expect(
    streamVideoStorage.invoke(empty.ctx, { library: 12345, video: "v" }),
  ).rejects.toThrow("The storage size of video v couldn't be read.");
});

test("stream.videos.list pages until a short page", async () => {
  const video = (n: number) => ({
    guid: `g${n}`,
    title: `Video ${n}`,
    status: 4,
  });
  const { ctx } = setup({
    "GET /library/{libraryId}/videos": ({ params }: Init) =>
      params?.query?.page === 1
        ? { items: [video(1), video(2)], itemsPerPage: 2 }
        : { items: [video(3)], itemsPerPage: 2 },
  });
  const videos = await streamVideosList.invoke(ctx, { library: 12345 });
  expect(videos).toEqual([
    { guid: "g1", title: "Video 1", status: 4 },
    { guid: "g2", title: "Video 2", status: 4 },
    { guid: "g3", title: "Video 3", status: 4 },
  ]);
});
