import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createStreamClient } from "@bunny.net/openapi-client";
import { BunnyStream } from "./bunny-stream.ts";
import type { Logger } from "./contracts.ts";

const silentLogger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makeClient(libraryId = 12345) {
  return new BunnyStream({
    client: createStreamClient({ apiKey: "test-key", userAgent: "test-agent" }),
    libraryId,
    requestTimeout: 5_000,
    processingTimeout: 30_000,
    logger: silentLogger,
    retryWait: async () => {},
  });
}

const page = (items: number[], currentPage: number, totalItems: number) =>
  json({
    items: items.map((n) => ({ guid: `v${n}`, title: `Video ${n}` })),
    totalItems,
    currentPage,
    itemsPerPage: 100,
  });

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  fetchMock = mock();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("requests", () => {
  test("sends the library key as AccessKey to the library path", async () => {
    fetchMock.mockResolvedValue(page([], 1, 0));

    await makeClient().listVideos();

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("AccessKey")).toBe("test-key");
    expect(request.url).toContain(
      "https://video.bunnycdn.com/library/12345/videos",
    );
  });

  test("rejects a library ID that is not a positive integer", () => {
    expect(() => makeClient(0)).toThrow(/Invalid Bunny library ID/);
  });
});

describe("pagination", () => {
  test("stops from the counters without a wasted request on an exact page multiple", async () => {
    fetchMock
      .mockResolvedValueOnce(page(range(100), 1, 150))
      .mockResolvedValueOnce(page(range(50), 2, 150));
    expect(await makeClient().listVideos()).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(page(range(100), 1, 100));
    expect(await makeClient().listVideos()).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to the page-size heuristic when the envelope omits counters", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ items: range(100).map((n) => ({ guid: `v${n}` })) }),
      )
      .mockResolvedValueOnce(json({ items: [{ guid: "tail" }] }));

    expect(await makeClient().listVideos()).toHaveLength(101);
  });
});

describe("errors", () => {
  test("getVideo returns null on 404 and surfaces Stream's message otherwise", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ success: false, message: "not found" }, { status: 404 }),
    );
    await expect(makeClient().getVideo("abc")).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(
      json({ message: "Boom", statusCode: 500 }, { status: 500 }),
    );
    await expect(makeClient().getVideo("abc")).rejects.toThrow("Boom");
  });
});

describe("rate limiting", () => {
  const limited = () =>
    new Response(null, { status: 429, headers: { "retry-after": "1" } });

  test("replays a POST body after a 429 and returns the eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(json({ guid: "col-1", name: "Holiday" }));

    await expect(
      makeClient().createCollection("Holiday"),
    ).resolves.toMatchObject({ guid: "col-1" });

    const replayed = fetchMock.mock.calls[1]?.[0] as Request;
    await expect(replayed.clone().json()).resolves.toEqual({ name: "Holiday" });
  });

  test("gives up with a clear error after the per-request retry budget", async () => {
    fetchMock.mockResolvedValue(limited());

    await expect(makeClient().listVideos()).rejects.toThrow(
      /rate limit exceeded after 5 retries/,
    );
    // 1 original + 5 retries.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("fetchVideoFromUrl", () => {
  test("returns the GUID Bunny sends back and passes the collection as a query param", async () => {
    fetchMock.mockResolvedValue(json({ success: true, id: "guid-123" }));

    const result = await makeClient().fetchVideoFromUrl(
      { url: "https://cdn.example.com/a.mp4", title: "A" },
      "col-9",
    );

    expect(result).toEqual({ success: true, videoId: "guid-123" });
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("collectionId=col-9");
  });

  test("reports a missing ID or a rejected fetch as a failure instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, statusCode: 200 }));
    const noId = await makeClient().fetchVideoFromUrl({
      url: "https://cdn.example.com/a.mp4",
    });
    expect(noId.success).toBe(false);
    expect(noId.error).toMatch(/no video ID/i);

    fetchMock.mockResolvedValueOnce(
      json({ success: false, message: "Invalid URL" }, { status: 400 }),
    );
    const rejected = await makeClient().fetchVideoFromUrl({
      url: "https://cdn.example.com/a.mp4",
    });
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain("Invalid URL");
  });
});

describe("getOrCreateCollection", () => {
  test("lists collections once, serves hits from cache, and caches what it creates", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          items: [{ guid: "c1", name: "Holiday" }],
          totalItems: 1,
          currentPage: 1,
          itemsPerPage: 100,
        }),
      )
      .mockResolvedValueOnce(json({ guid: "new-1", name: "Fresh" }));

    const client = makeClient();
    await expect(
      client.getOrCreateCollection("holiday"),
    ).resolves.toMatchObject({ guid: "c1" });
    await client.getOrCreateCollection("Fresh");
    await client.getOrCreateCollection("Fresh");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
