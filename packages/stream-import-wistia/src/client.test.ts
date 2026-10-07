import { afterEach, expect, test } from "bun:test";
import type { Logger } from "@bunny.net/stream-import";
import { WistiaSourceAdapter } from "./adapter.ts";
import { selectDownload, validateWistiaUrl, WistiaClient } from "./client.ts";
import type { WistiaAsset, WistiaMedia } from "./types.ts";

const asset = (type: string, url: string): WistiaAsset => ({
  type,
  url,
  width: 0,
  height: 0,
  fileSize: 1,
  contentType: "video/mp4",
});

const media = (overrides: Partial<WistiaMedia>): WistiaMedia => ({
  id: 1,
  name: "m",
  hashed_id: "abc",
  description: null,
  duration: 1,
  created: "",
  updated: "",
  type: "Video",
  status: "ready",
  ...overrides,
});

test("prefers the original, upgrades Wistia's http delivery URLs to https, and refuses unfinished medias", () => {
  const assets = [
    asset("HdMp4VideoFile", "https://embed.wistia.com/deliveries/hd.bin"),
    asset("OriginalFile", "http://embed.wistia.com/deliveries/orig.bin"),
  ];
  const download = selectDownload(media({ assets }));
  expect(download?.url).toBe("https://embed.wistia.com/deliveries/orig.bin");
  expect(validateWistiaUrl(download?.url ?? "")).toBe(true);
  expect(validateWistiaUrl("https://wistia.com.attacker.example/a.bin")).toBe(
    false,
  );
  expect(() => selectDownload(media({ assets, status: "processing" }))).toThrow(
    "processing",
  );
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a folder id is the project hashedId, but medias are listed by the numeric project id, oldest first", async () => {
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    return Response.json(
      url.pathname.endsWith("/projects.json")
        ? [{ id: 42, hashedId: "p1", name: "Launch", mediaCount: 1 }]
        : [media({ hashed_id: "m1" })],
    );
  }) as unknown as typeof fetch;
  const silent = {} as Logger;
  const adapter = new WistiaSourceAdapter(
    new WistiaClient(
      { accessToken: "t" },
      { userAgent: "test", requestTimeout: 5_000, logger: silent },
    ),
  );

  const content = await adapter.listContent({ folderId: "p1" });

  const params = urls[1]?.searchParams;
  expect(params?.get("project_id")).toBe("42");
  expect(params?.get("sort_by")).toBe("created");
  expect(params?.get("sort_direction")).toBe("1");
  expect(content.videos.get("p1")?.[0]?.sourceId).toBe("m1");
});
