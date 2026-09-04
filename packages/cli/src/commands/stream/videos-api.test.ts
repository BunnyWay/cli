import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedConfig } from "@/config/index.ts";
import type { VideoLibraryModel } from "./api.ts";
import {
  cleanupVideoResolutions,
  connectStreamLibrary,
  createVideo,
  deleteVideo,
  directPlayUrl,
  fetchVideo,
  fetchVideoHeatmap,
  fetchVideoPlayData,
  fetchVideoResolutions,
  fetchVideoStatistics,
  fetchVideos,
  formatDuration,
  queueVideoFetch,
  reencodeVideo,
  type StreamClient,
  setVideoThumbnail,
  smartGenerateVideo,
  transcribeVideo,
  updateVideo,
  uploadVideoFile,
  type VideoModel,
  videoStatusLabel,
} from "./videos-api.ts";

const CONFIG: ResolvedConfig = {
  apiKey: "account-key",
  // The core API host must not leak into the Stream client.
  apiUrl: "https://api.bunny.net",
  profile: "default",
};

const LIBRARY: VideoLibraryModel = {
  Id: 4321,
  Name: "my-library",
  ApiKey: "library-key",
};

const VIDEO: VideoModel = {
  videoLibraryId: 4321,
  guid: "video-guid",
  title: "clip.mp4",
  status: 1,
} as VideoModel;

interface Call {
  method: string;
  path: string;
  init?: Record<string, any>;
}

/** Path-branching fake stream client: only the video endpoints used here exist. */
function fakeStreamClient(opts: {
  calls: Call[];
  video?: VideoModel | undefined;
  error?: unknown;
}): StreamClient {
  const record = (method: string) => async (path: string, init?: any) => {
    opts.calls.push({ method, path, init });
    if (opts.error !== undefined) return { error: opts.error };
    return { data: opts.video };
  };
  return {
    GET: record("GET"),
    POST: record("POST"),
    PUT: record("PUT"),
    DELETE: record("DELETE"),
  } as unknown as StreamClient;
}

/**
 * Fake client for the paginated listing. `totalItems` is settable on its own so
 * a server that over-reports (and would page forever) can be exercised.
 */
function fakeListClient(opts: {
  calls: Call[];
  videos: VideoModel[];
  pageSize?: number;
  totalItems?: number;
  /** Model an API that sends no totalItems at all. */
  omitTotal?: boolean;
}): StreamClient {
  return {
    GET: async (path: string, init?: any) => {
      opts.calls.push({ method: "GET", path, init });
      const query = init?.params?.query ?? {};
      const search = (query.search ?? "") as string;
      const matched = search
        ? opts.videos.filter((video) => video.title.includes(search))
        : opts.videos;
      const size = opts.pageSize ?? Math.max(matched.length, 1);
      const start = ((query.page ?? 1) - 1) * size;
      return {
        data: {
          ...(opts.omitTotal
            ? {}
            : { totalItems: opts.totalItems ?? matched.length }),
          currentPage: query.page,
          itemsPerPage: size,
          items: matched.slice(start, start + size),
        },
      };
    },
  } as unknown as StreamClient;
}

const VIDEOS: VideoModel[] = [
  { ...VIDEO, guid: "a", title: "alpha" },
  { ...VIDEO, guid: "b", title: "beta" },
  { ...VIDEO, guid: "c", title: "gamma" },
];

let dir = "";
let file = "";
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-"));
  file = join(dir, "clip.mp4");
  await Bun.write(file, "video-bytes");
});

afterEach(async () => {
  globalThis.fetch = realFetch;
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
    return new Response(JSON.stringify(VIDEO), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const client = connectStreamLibrary(LIBRARY, { config: CONFIG });
  await fetchVideo(client, 4321, "video-guid");

  expect(request?.url).toBe(
    "https://video.bunnycdn.com/library/4321/videos/video-guid",
  );
  // The per-library key authenticates, not the account key from the config.
  expect(request?.headers.get("AccessKey")).toBe("library-key");
});

test("createVideo posts the title and returns the created video", async () => {
  const calls: Call[] = [];
  const client = fakeStreamClient({ calls, video: VIDEO });

  const video = await createVideo(client, 4321, "clip.mp4");

  expect(video.guid).toBe("video-guid");
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.path).toBe("/library/{libraryId}/videos");
  expect(calls[0]?.init?.params).toEqual({ path: { libraryId: 4321 } });
  expect(calls[0]?.init?.body).toEqual({ title: "clip.mp4" });
});

test("createVideo fails loudly when no video comes back", async () => {
  const client = fakeStreamClient({ calls: [], video: undefined });
  await expect(createVideo(client, 4321, "clip.mp4")).rejects.toThrow(
    'Creating the video "clip.mp4" did not return a video ID.',
  );
});

test("fetchVideos drains every page until totalItems is covered", async () => {
  const calls: Call[] = [];
  const client = fakeListClient({ calls, videos: VIDEOS, pageSize: 2 });

  const videos = await fetchVideos(client, 4321);

  expect(videos.map((video) => video.guid)).toEqual(["a", "b", "c"]);
  const pages = calls.map((call) => call.init?.params?.query?.page);
  expect(pages).toEqual([1, 2]);
  expect(calls[0]?.path).toBe("/library/{libraryId}/videos");
  expect(calls[0]?.init?.params?.path).toEqual({ libraryId: 4321 });
});

test("fetchVideos asks for a single page when everything fits", async () => {
  const calls: Call[] = [];
  const videos = await fetchVideos(
    fakeListClient({ calls, videos: VIDEOS }),
    4321,
  );
  expect(videos).toHaveLength(3);
  expect(calls).toHaveLength(1);
});

// Without the empty-page guard, a totalItems that never gets reached loops forever.
test("fetchVideos stops on an empty page even if totalItems over-reports", async () => {
  const calls: Call[] = [];
  const client = fakeListClient({
    calls,
    videos: VIDEOS,
    pageSize: 3,
    totalItems: 99,
  });

  const videos = await fetchVideos(client, 4321);

  expect(videos).toHaveLength(3);
  expect(calls).toHaveLength(2);
});

// Without totalItems the old loop stopped after the first page.
test("fetchVideos drains on page fullness when totalItems is absent", async () => {
  const many: VideoModel[] = Array.from({ length: 5 }, (_, i) => ({
    ...VIDEO,
    guid: `v${i}`,
    title: `clip ${i}`,
  }));
  const calls: Call[] = [];

  const videos = await fetchVideos(
    fakeListClient({ calls, videos: many, pageSize: 2, omitTotal: true }),
    4321,
  );

  // Two full pages, then a short one that ends the drain.
  expect(videos.map((video) => video.guid)).toEqual([
    "v0",
    "v1",
    "v2",
    "v3",
    "v4",
  ]);
  expect(calls).toHaveLength(3);
});

// A total smaller than reality used to truncate the listing; it is now only a
// ceiling, and the full-page rule keeps reading until a short page arrives.
test("fetchVideos treats an under-reported total as a ceiling, not a promise", async () => {
  const calls: Call[] = [];
  const videos = await fetchVideos(
    fakeListClient({ calls, videos: VIDEOS, pageSize: 2, totalItems: 2 }),
    4321,
  );
  // The ceiling is hit on the first page, so the drain stops there by design.
  expect(videos).toHaveLength(2);
  expect(calls).toHaveLength(1);
});

test("fetchVideos passes the search term through", async () => {
  const calls: Call[] = [];
  const videos = await fetchVideos(
    fakeListClient({ calls, videos: VIDEOS }),
    4321,
    { search: "alph" },
  );

  expect(videos.map((video) => video.title)).toEqual(["alpha"]);
  expect(calls[0]?.init?.params?.query?.search).toBe("alph");
});

test("fetchVideos returns an empty list for an empty library", async () => {
  expect(
    await fetchVideos(fakeListClient({ calls: [], videos: [] }), 4321),
  ).toEqual([]);
});

test("updateVideo posts only the changed fields", async () => {
  const calls: Call[] = [];
  await updateVideo(fakeStreamClient({ calls }), 4321, "video-guid", {
    title: "Launch demo",
  });

  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.path).toBe("/library/{libraryId}/videos/{videoId}");
  expect(calls[0]?.init?.params).toEqual({
    path: { libraryId: 4321, videoId: "video-guid" },
  });
  expect(calls[0]?.init?.body).toEqual({ title: "Launch demo" });
});

/** Fake for the server-side fetch endpoint, whose response is a StatusModel. */
function fakeFetchClient(opts: {
  calls: Call[];
  status?: unknown;
}): StreamClient {
  return {
    POST: async (path: string, init?: any) => {
      opts.calls.push({ method: "POST", path, init });
      return { data: opts.status };
    },
  } as unknown as StreamClient;
}

test("queueVideoFetch posts the URL, title, and headers", async () => {
  const calls: Call[] = [];
  const client = fakeFetchClient({
    calls,
    status: { success: true, message: "Video queued", statusCode: 200 },
  });

  const status = await queueVideoFetch(client, 4321, {
    url: "https://example.com/video.mp4",
    title: "Launch demo",
    headers: { Authorization: "Bearer abc" },
  });

  expect(status.message).toBe("Video queued");
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.path).toBe("/library/{libraryId}/videos/fetch");
  expect(calls[0]?.init?.params).toEqual({
    path: { libraryId: 4321 },
    query: {},
  });
  expect(calls[0]?.init?.body).toEqual({
    url: "https://example.com/video.mp4",
    title: "Launch demo",
    headers: { Authorization: "Bearer abc" },
  });
});

// collectionId is a query param on this endpoint, not a body field.
test("queueVideoFetch puts the collection in the query string", async () => {
  const calls: Call[] = [];
  await queueVideoFetch(
    fakeFetchClient({ calls, status: { success: true } }),
    4321,
    { url: "https://example.com/video.mp4" },
    { collectionId: "collection-guid" },
  );

  expect(calls[0]?.init?.params?.query).toEqual({
    collectionId: "collection-guid",
  });
  expect(JSON.stringify(calls[0]?.init?.body)).not.toContain("collection");
});

// An unset title lets the API name the video after the remote file.
test("queueVideoFetch leaves an unset title and headers out of the body", async () => {
  const calls: Call[] = [];
  await queueVideoFetch(
    fakeFetchClient({ calls, status: { success: true } }),
    4321,
    {
      url: "https://example.com/video.mp4",
      title: undefined,
      headers: undefined,
    },
  );

  expect(JSON.stringify(calls[0]?.init?.body)).toBe(
    '{"url":"https://example.com/video.mp4"}',
  );
});

// This endpoint answers 200 with success: false for a URL it would not accept.
test("queueVideoFetch turns a failed status into a user-facing error", async () => {
  const client = fakeFetchClient({
    calls: [],
    status: { success: false, message: "Invalid URL", statusCode: 400 },
  });

  await expect(
    queueVideoFetch(client, 4321, { url: "https://example.com/nope" }),
  ).rejects.toThrow(
    "bunny.net could not fetch https://example.com/nope: Invalid URL",
  );
});

test("queueVideoFetch tolerates an empty body on success", async () => {
  const client = fakeFetchClient({ calls: [], status: undefined });
  expect(
    await queueVideoFetch(client, 4321, { url: "https://example.com/v.mp4" }),
  ).toEqual({});
});

test("fetchVideo reports a missing video", async () => {
  const client = fakeStreamClient({ calls: [], video: undefined });
  await expect(fetchVideo(client, 4321, "nope")).rejects.toThrow(
    "Video nope not found.",
  );
});

test("uploadVideoFile PUTs an octet-stream body through an identity serializer", async () => {
  const calls: Call[] = [];
  const client = fakeStreamClient({ calls, video: undefined });

  await uploadVideoFile(client, 4321, "video-guid", file);

  const [call] = calls;
  expect(call?.method).toBe("PUT");
  expect(call?.path).toBe("/library/{libraryId}/videos/{videoId}");
  expect(call?.init?.params).toEqual({
    path: { libraryId: 4321, videoId: "video-guid" },
  });
  expect(call?.init?.headers).toEqual({
    "Content-Type": "application/octet-stream",
  });
  // The body must reach fetch untouched: openapi-fetch JSON-stringifies otherwise.
  const body = call?.init?.body;
  expect(call?.init?.bodySerializer(body)).toBe(body);
  expect(body.size).toBe("video-bytes".length);
});

test("uploadVideoFile sends the file's bytes as application/octet-stream", async () => {
  let request: Request | undefined;
  globalThis.fetch = (async (input: Request) => {
    request = input;
    return new Response(JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const client = connectStreamLibrary(LIBRARY, { config: CONFIG });
  await uploadVideoFile(client, 4321, "video-guid", file);

  expect(request?.method).toBe("PUT");
  expect(request?.headers.get("content-type")).toBe("application/octet-stream");
  expect(await request?.text()).toBe("video-bytes");
});

test("uploadVideoFile surfaces the API message on failure", async () => {
  const client = fakeStreamClient({
    calls: [],
    error: { message: "The requested video was already uploaded" },
  });
  await expect(
    uploadVideoFile(client, 4321, "video-guid", file),
  ).rejects.toThrow(/already uploaded/);
});

test("uploadVideoFile wraps a thrown API error as a user-facing error", async () => {
  const client = {
    PUT: async () => {
      throw new Error("Unauthorized. Check your API key.");
    },
  } as unknown as StreamClient;
  await expect(
    uploadVideoFile(client, 4321, "video-guid", file),
  ).rejects.toThrow(/Unauthorized/);
});

test("deleteVideo removes the video by ID", async () => {
  const calls: Call[] = [];
  await deleteVideo(fakeStreamClient({ calls }), 4321, "video-guid");

  expect(calls[0]?.method).toBe("DELETE");
  expect(calls[0]?.path).toBe("/library/{libraryId}/videos/{videoId}");
  expect(calls[0]?.init?.params).toEqual({
    path: { libraryId: 4321, videoId: "video-guid" },
  });
});

test("formatDuration renders m:ss, and h:mm:ss past an hour", () => {
  expect(formatDuration(0)).toBe("0:00");
  expect(formatDuration(5)).toBe("0:05");
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(599)).toBe("9:59");
  expect(formatDuration(3600)).toBe("1:00:00");
  expect(formatDuration(3725)).toBe("1:02:05");
  expect(formatDuration(59.6)).toBe("1:00");
});

test("formatDuration dashes an unknown or nonsense length", () => {
  expect(formatDuration(undefined)).toBe("—");
  expect(formatDuration(null)).toBe("—");
  expect(formatDuration(-1)).toBe("—");
  expect(formatDuration(Number.NaN)).toBe("—");
});

test("directPlayUrl is derived from the library and video IDs", () => {
  expect(directPlayUrl(4321, "video-guid")).toBe(
    "https://iframe.mediadelivery.net/play/4321/video-guid",
  );
});

test("setVideoThumbnail sends a URL as a query param, with no body", async () => {
  const calls: Call[] = [];
  const client = fakeFetchClient({ calls, status: { success: true } });

  await setVideoThumbnail(client, 4321, "video-guid", {
    url: "https://example.com/thumb.jpg",
  });

  expect(calls[0]?.path).toBe(
    "/library/{libraryId}/videos/{videoId}/thumbnail",
  );
  expect(calls[0]?.init?.params).toEqual({
    path: { libraryId: 4321, videoId: "video-guid" },
    query: { thumbnailUrl: "https://example.com/thumb.jpg" },
  });
  expect(calls[0]?.init?.body).toBeUndefined();
});

test("setVideoThumbnail uploads a file as an octet-stream body", async () => {
  const calls: Call[] = [];
  const client = fakeFetchClient({ calls, status: { success: true } });

  await setVideoThumbnail(client, 4321, "video-guid", { file });

  expect(calls[0]?.init?.params?.query).toEqual({});
  expect(calls[0]?.init?.headers).toEqual({
    "Content-Type": "application/octet-stream",
  });
  const body = calls[0]?.init?.body;
  expect(calls[0]?.init?.bodySerializer(body)).toBe(body);
  expect(body.size).toBe("video-bytes".length);
});

test("setVideoThumbnail surfaces a failed status", async () => {
  const client = fakeFetchClient({
    calls: [],
    status: { success: false, message: "Invalid image" },
  });
  await expect(
    setVideoThumbnail(client, 4321, "video-guid", {
      url: "https://example.com/x.jpg",
    }),
  ).rejects.toThrow("Setting the thumbnail failed: Invalid image");
});

test("fetchVideoResolutions unwraps the status envelope", async () => {
  const info = { videoId: "video-guid", availableResolutions: ["720p"] };
  const client = {
    GET: async () => ({ data: { success: true, data: info } }),
  } as unknown as StreamClient;

  expect(await fetchVideoResolutions(client, 4321, "video-guid")).toEqual(info);
});

test("fetchVideoResolutions reports an empty envelope", async () => {
  const client = {
    GET: async () => ({ data: { success: true } }),
  } as unknown as StreamClient;
  await expect(fetchVideoResolutions(client, 4321, "nope")).rejects.toThrow(
    "No resolution information for video nope.",
  );
});

test("cleanupVideoResolutions passes every selector as a query param", async () => {
  const calls: Call[] = [];
  const client = fakeFetchClient({ calls, status: { success: true } });

  await cleanupVideoResolutions(client, 4321, "video-guid", {
    resolutionsToDelete: "240p,360p",
    deleteOriginal: true,
    dryRun: true,
  });

  expect(calls[0]?.path).toBe(
    "/library/{libraryId}/videos/{videoId}/resolutions/cleanup",
  );
  expect(calls[0]?.init?.params?.query).toEqual({
    resolutionsToDelete: "240p,360p",
    deleteOriginal: true,
    dryRun: true,
  });
});

test("cleanupVideoResolutions surfaces a failed status", async () => {
  const client = fakeFetchClient({
    calls: [],
    status: { success: false, message: "Nothing to delete" },
  });
  await expect(
    cleanupVideoResolutions(client, 4321, "video-guid", {
      allResolutions: true,
    }),
  ).rejects.toThrow("Cleanup failed: Nothing to delete");
});

// Statistics are library-level with an optional video filter; there is no per-video path.
test("fetchVideoStatistics filters by videoGuid on the library endpoint", async () => {
  const calls: Call[] = [];
  const client = {
    GET: async (path: string, init?: any) => {
      calls.push({ method: "GET", path, init });
      return { data: { viewsChart: { "2026-09-01": 3 } } };
    },
  } as unknown as StreamClient;

  const stats = await fetchVideoStatistics(client, 4321, {
    videoGuid: "video-guid",
    hourly: true,
  });

  expect(stats.viewsChart).toEqual({ "2026-09-01": 3 });
  expect(calls[0]?.path).toBe("/library/{libraryId}/statistics");
  expect(calls[0]?.init?.params).toEqual({
    path: { libraryId: 4321 },
    query: { videoGuid: "video-guid", hourly: true },
  });
});

test("fetchVideoHeatmap and fetchVideoPlayData use the per-video paths", async () => {
  const paths: string[] = [];
  const client = {
    GET: async (path: string) => {
      paths.push(path);
      return { data: { heatmap: { "0": 100 }, libraryName: "my-library" } };
    },
  } as unknown as StreamClient;

  expect((await fetchVideoHeatmap(client, 4321, "video-guid")).heatmap).toEqual(
    { "0": 100 },
  );
  expect(
    (await fetchVideoPlayData(client, 4321, "video-guid")).libraryName,
  ).toBe("my-library");
  expect(paths).toEqual([
    "/library/{libraryId}/videos/{videoId}/heatmap",
    "/library/{libraryId}/videos/{videoId}/play",
  ]);
});

test("the per-video getters report an empty response", async () => {
  const empty = {
    GET: async () => ({ data: undefined }),
  } as unknown as StreamClient;
  await expect(fetchVideoHeatmap(empty, 4321, "v")).rejects.toThrow(
    "No heatmap available for video v.",
  );
  await expect(fetchVideoPlayData(empty, 4321, "v")).rejects.toThrow(
    "No play data available for video v.",
  );
  await expect(fetchVideoStatistics(empty, 4321)).rejects.toThrow(
    "No statistics returned for this library.",
  );
});

test("videoStatusLabel names every status the spec enumerates", () => {
  expect(videoStatusLabel(0)).toBe("Created");
  expect(videoStatusLabel(4)).toBe("Finished");
  expect(videoStatusLabel(8)).toBe("JitPlaylistsCreated");
  expect(videoStatusLabel(99)).toBe("99");
  expect(videoStatusLabel(undefined)).toBe("—");
});

test("reencodeVideo posts to the reencode path and returns the video", async () => {
  const calls: Call[] = [];
  const client = {
    POST: async (path: string, init?: any) => {
      calls.push({ method: "POST", path, init });
      return { data: { ...VIDEO, status: 3 } };
    },
  } as unknown as StreamClient;

  const video = await reencodeVideo(client, 4321, "video-guid");

  expect(video.status).toBe(3);
  expect(calls[0]?.path).toBe("/library/{libraryId}/videos/{videoId}/reencode");
  expect(calls[0]?.init?.params?.path).toEqual({
    libraryId: 4321,
    videoId: "video-guid",
  });
});

test("reencodeVideo reports a rejected request", async () => {
  const client = {
    POST: async () => ({ data: undefined }),
  } as unknown as StreamClient;
  await expect(reencodeVideo(client, 4321, "v")).rejects.toThrow(
    "Re-encoding video v was not accepted.",
  );
});

// force is a query param on this endpoint; the settings travel in the body.
test("transcribeVideo splits force into the query and settings into the body", async () => {
  const calls: Call[] = [];
  const client = fakeFetchClient({ calls, status: { success: true } });

  await transcribeVideo(
    client,
    4321,
    "video-guid",
    { targetLanguages: ["en", "de"], generateTitle: true },
    { force: true },
  );

  expect(calls[0]?.path).toBe(
    "/library/{libraryId}/videos/{videoId}/transcribe",
  );
  expect(calls[0]?.init?.params?.query).toEqual({ force: true });
  expect(calls[0]?.init?.body).toEqual({
    targetLanguages: ["en", "de"],
    generateTitle: true,
  });
});

test("transcribeVideo surfaces a failed status", async () => {
  const client = fakeFetchClient({
    calls: [],
    status: { success: false, message: "Already transcribing" },
  });
  await expect(transcribeVideo(client, 4321, "v", {})).rejects.toThrow(
    "Transcribing was not accepted: Already transcribing",
  );
});

test("smartGenerateVideo posts the generation flags", async () => {
  const calls: Call[] = [];
  const client = fakeFetchClient({ calls, status: { success: true } });

  await smartGenerateVideo(client, 4321, "video-guid", {
    generateTitle: true,
    generateChapters: true,
  });

  expect(calls[0]?.path).toBe("/library/{libraryId}/videos/{videoId}/smart");
  expect(calls[0]?.init?.body).toEqual({
    generateTitle: true,
    generateChapters: true,
  });
});

test("smartGenerateVideo surfaces a failed status", async () => {
  const client = fakeFetchClient({
    calls: [],
    status: { success: false, message: "Rate limited" },
  });
  await expect(
    smartGenerateVideo(client, 4321, "v", { generateTitle: true }),
  ).rejects.toThrow("Smart generation was not accepted: Rate limited");
});

test("createVideo passes the collection and thumbnail time through", async () => {
  const calls: Call[] = [];
  const client = fakeStreamClient({ calls, video: VIDEO });

  await createVideo(client, 4321, "clip.mp4", {
    collectionId: "collection-guid",
    thumbnailTime: 5000,
  });

  expect(calls[0]?.init?.body).toEqual({
    title: "clip.mp4",
    collectionId: "collection-guid",
    thumbnailTime: 5000,
  });
});
