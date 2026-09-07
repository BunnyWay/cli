import { expect, test } from "bun:test";
import { parseFetchHeaders, validateFetchUrl } from "./fetch.ts";

test("parseFetchHeaders builds the header map, trimming around the colon", () => {
  expect(
    parseFetchHeaders(["Authorization: Bearer abc", "X-Tenant:acme"]),
  ).toEqual({
    Authorization: "Bearer abc",
    "X-Tenant": "acme",
  });
});

test("parseFetchHeaders keeps colons inside the value", () => {
  expect(parseFetchHeaders(["Referer: https://example.com/a"])).toEqual({
    Referer: "https://example.com/a",
  });
});

test("parseFetchHeaders returns undefined when no headers were passed", () => {
  expect(parseFetchHeaders(undefined)).toBeUndefined();
  expect(parseFetchHeaders([])).toBeUndefined();
});

test("parseFetchHeaders rejects a header with no name", () => {
  expect(() => parseFetchHeaders(["Authorization Bearer abc"])).toThrow(
    /Invalid --header/,
  );
  expect(() => parseFetchHeaders([": value"])).toThrow(/Invalid --header/);
});

test("validateFetchUrl accepts http and https, trimmed", () => {
  expect(validateFetchUrl("https://example.com/video.mp4")).toBe(
    "https://example.com/video.mp4",
  );
  expect(validateFetchUrl("  http://example.com/v.mp4  ")).toBe(
    "http://example.com/v.mp4",
  );
  expect(validateFetchUrl("HTTPS://example.com/v.mp4")).toBe(
    "HTTPS://example.com/v.mp4",
  );
});

// A local path here is almost certainly a mistaken `fetch` for an `upload`.
test("validateFetchUrl rejects a local path or another scheme", () => {
  expect(() => validateFetchUrl("./video.mp4")).toThrow(/Not an http\(s\) URL/);
  expect(() => validateFetchUrl("/abs/video.mp4")).toThrow(
    /Not an http\(s\) URL/,
  );
  expect(() => validateFetchUrl("ftp://example.com/v.mp4")).toThrow(
    /Not an http\(s\) URL/,
  );
  expect(() => validateFetchUrl("https://")).toThrow(/Not an http\(s\) URL/);
});
