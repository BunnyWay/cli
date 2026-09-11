import { expect, test } from "bun:test";
import { validateVimeoId, validateVimeoUrl } from "./validate.ts";

test("ids are numeric only, so nothing can escape a URL path segment", () => {
  expect(validateVimeoId("123456789")).toBe(true);
  for (const bad of ["../../me/videos", "123/456", "12 34", "", "abc"]) {
    expect(validateVimeoId(bad), bad).toBe(false);
  }
});

test("download URLs must be HTTPS on the Vimeo CDN allowlist, including subdomains but not lookalikes", () => {
  for (const url of [
    "https://player.vimeo.com/progressive/file.mp4",
    "https://vod-progressive.akamaized.net/exp/video.mp4",
    "https://skyfire.vimeocdn.com/a.mp4",
    "https://PLAYER.VIMEO.COM/a.mp4",
  ]) {
    expect(validateVimeoUrl(url), url).toBe(true);
  }
  for (const url of [
    "https://evil-vimeo.com/a.mp4",
    "https://notvimeocdn.com/a.mp4",
    "https://vimeo.com@attacker.example.com/a.mp4",
    "https://attacker.example.com/?x=vimeo.com",
    "http://player.vimeo.com/a.mp4",
    "not a url",
  ]) {
    expect(validateVimeoUrl(url), url).toBe(false);
  }
});
