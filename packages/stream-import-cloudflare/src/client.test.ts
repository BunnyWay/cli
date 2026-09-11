import { afterEach, expect, test } from "bun:test";
import type { Logger } from "@bunny.net/stream-import";
import { CloudflareStreamClient } from "./client.ts";

const silent: Logger = {
  log() {},
  debug() {},
  info() {},
  success() {},
  warn() {},
  error() {},
  dim() {},
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const video = (n: number, created: string, ready = true) => ({
  uid: `v${n}`,
  created,
  readyToStream: ready,
});

test("walks the list oldest-first on a date cursor, stepping back a second and de-duplicating the overlap", async () => {
  const urls: string[] = [];
  const boundary = "2024-01-01T00:00:10Z";
  const firstPage = Array.from({ length: 1000 }, (_, i) =>
    video(i, i < 999 ? "2024-01-01T00:00:01Z" : boundary, i !== 0),
  );
  const secondPage = [
    video(999, boundary),
    video(1000, "2024-01-01T00:00:11Z"),
  ];
  globalThis.fetch = (async (input: string | URL) => {
    urls.push(String(input));
    return Response.json({
      result: urls.length === 1 ? firstPage : secondPage,
    });
  }) as unknown as typeof fetch;

  const client = new CloudflareStreamClient(
    { apiToken: "t", accountId: "acc" },
    { userAgent: "test", requestTimeout: 5_000, logger: silent },
  );
  const videos = await client.listVideos();

  expect(urls).toHaveLength(2);
  const first = new URL(urls[0] as string);
  expect(first.searchParams.get("limit")).toBe("1000");
  expect(first.searchParams.get("asc")).toBe("true");
  expect(first.searchParams.has("after")).toBe(false);
  expect(new URL(urls[1] as string).searchParams.get("after")).toBe(
    "2024-01-01T00:00:09.000Z",
  );
  // 1001 distinct uids, minus the one that is not ready.
  expect(videos).toHaveLength(1000);
  expect(new Set(videos.map((v) => v.uid)).size).toBe(1000);
});
