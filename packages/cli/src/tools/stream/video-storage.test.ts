import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import {
  type CoreClient,
  createToolContext,
  type StreamClient,
} from "@/tools/context.ts";
import { streamVideoStorage, toVideoStorage } from "./index.ts";

const LIBRARY = { Id: 12345, Name: "lib", ApiKey: "library-key" };

/** Fake core and Stream clients answering by "METHOD path". */
function setup(routes: Record<string, unknown | (() => unknown)>) {
  const answer = (method: string) => (path: string) => {
    if (method === "GET" && path === "/videolibrary/{id}")
      return Promise.resolve({ data: LIBRARY });
    if (method === "GET" && path === "/user")
      return Promise.resolve({ data: { AccountId: "acc" } });
    const route = routes[`${method} ${path}`];
    if (typeof route !== "function") return Promise.resolve({ data: route });
    try {
      return Promise.resolve({ data: route() });
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

  const missing = setup({
    "GET /library/{libraryId}/videos/{videoId}/storage": () => {
      throw new ApiError("Not Found", 404);
    },
  });
  await expect(
    streamVideoStorage.invoke(missing.ctx, { library: 12345, video: "v" }),
  ).rejects.toThrow("Video v not found.");
});
