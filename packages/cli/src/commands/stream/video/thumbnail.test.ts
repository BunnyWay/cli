import { expect, test } from "bun:test";
import { thumbnailSource } from "./thumbnail.ts";

test("thumbnailSource picks the URL or the file", () => {
  expect(thumbnailSource("https://example.com/t.jpg", undefined)).toEqual({
    url: "https://example.com/t.jpg",
  });
  expect(thumbnailSource(undefined, "./thumb.jpg")).toEqual({
    file: "./thumb.jpg",
  });
});

test("thumbnailSource trims its input", () => {
  expect(thumbnailSource("  https://example.com/t.jpg ", undefined)).toEqual({
    url: "https://example.com/t.jpg",
  });
  expect(thumbnailSource(undefined, " ./thumb.jpg ")).toEqual({
    file: "./thumb.jpg",
  });
});

// The endpoint takes one source per call, so two would silently drop one.
test("thumbnailSource refuses both sources at once", () => {
  expect(() => thumbnailSource("https://example.com/t.jpg", "./t.jpg")).toThrow(
    /Pass either --url or --file, not both/,
  );
});

test("thumbnailSource requires one source", () => {
  expect(() => thumbnailSource(undefined, undefined)).toThrow(
    /A thumbnail is required/,
  );
  expect(() => thumbnailSource("  ", " ")).toThrow(/A thumbnail is required/);
});

test("thumbnailSource rejects a --url that is not http(s)", () => {
  expect(() => thumbnailSource("./local.jpg", undefined)).toThrow(
    /Not an http\(s\) URL/,
  );
});
