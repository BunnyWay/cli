import { expect, test } from "bun:test";
import prompts from "prompts";
import { withTTY } from "../test-tty.ts";
import { fetchUrlArg, parseFetchHeaders, validateFetchUrl } from "./fetch.ts";

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

test("fetchUrlArg errors with usage when the URL is missing and there is nobody to ask", async () => {
  await expect(fetchUrlArg(undefined, "json")).rejects.toThrow(
    "A video URL is required.",
  );
});

test("fetchUrlArg asks for a missing URL interactively", async () => {
  prompts.inject([" https://example.com/video.mp4 "]);
  expect(await withTTY(() => fetchUrlArg(undefined, "text"))).toBe(
    "https://example.com/video.mp4",
  );
});
