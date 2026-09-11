import { expect, test } from "bun:test";
import { bestMp4Source } from "./client.ts";

test("picks the widest HTTPS MP4 and ignores http:// renditions", () => {
  expect(
    bestMp4Source([
      { src: "http://cdn.example.com/4k.mp4", container: "MP4", width: 3840 },
      { src: "https://cdn.example.com/720.mp4", container: "MP4", width: 1280 },
      {
        src: "https://cdn.example.com/1080.mp4",
        type: "video/mp4",
        width: 1920,
      },
      {
        src: "https://cdn.example.com/master.m3u8",
        container: "M2TS",
        width: 3840,
      },
    ])?.src,
  ).toBe("https://cdn.example.com/1080.mp4");
  expect(
    bestMp4Source([
      { src: "http://cdn.example.com/only.mp4", container: "MP4" },
    ]),
  ).toBeUndefined();
});
