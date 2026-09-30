import { expect, test } from "bun:test";
import { thumbnailSource } from "./thumbnail.ts";

// The endpoint takes one source per call, so two would silently drop one.
test("thumbnailSource refuses both sources at once", () => {
  expect(() => thumbnailSource("https://example.com/t.jpg", "./t.jpg")).toThrow(
    /Pass either --url or --file, not both/,
  );
});

test("thumbnailSource needs a real source: blank is missing, --url must be http(s)", () => {
  expect(() => thumbnailSource("  ", " ")).toThrow(/A thumbnail is required/);
  expect(() => thumbnailSource("./local.jpg", undefined)).toThrow(
    /Not an http\(s\) URL/,
  );
});
