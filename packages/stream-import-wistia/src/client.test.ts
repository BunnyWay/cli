import { expect, test } from "bun:test";
import { selectDownload, validateWistiaUrl } from "./client.ts";
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
