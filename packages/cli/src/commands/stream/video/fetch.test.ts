import { expect, test } from "bun:test";
import { parseFetchHeaders, validateFetchUrl } from "./fetch.ts";

test("parseFetchHeaders splits on the first colon and needs a name", () => {
  expect(parseFetchHeaders(["Referer: https://example.com/a"])).toEqual({
    Referer: "https://example.com/a",
  });
  expect(() => parseFetchHeaders([": value"])).toThrow(/Invalid --header/);
});

// A local path here is almost certainly a mistaken `fetch` for an `upload`.
test("validateFetchUrl rejects a local path", () => {
  expect(() => validateFetchUrl("./video.mp4")).toThrow(/Not an http\(s\) URL/);
});
