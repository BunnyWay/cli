import { expect, test } from "bun:test";
import { resolveRequestUrl } from "./api.ts";

const BASE = "https://api.bunny.net";

test("appends a path to the base URL", () => {
  expect(resolveRequestUrl("/pullzone", BASE)).toBe(`${BASE}/pullzone`);
  expect(resolveRequestUrl("pullzone", BASE)).toBe(`${BASE}/pullzone`);
});

test("uses a full URL on a bunny.net API host as-is", () => {
  const url = "https://logging.bunnycdn.com/v2/pullzones/1/logs?limit=5";
  expect(resolveRequestUrl(url, BASE)).toBe(url);
});

test("refuses to send the key to any other host or over http", () => {
  expect(() => resolveRequestUrl("https://example.com/x", BASE)).toThrow(
    "Refusing to send your API key",
  );
  expect(() =>
    resolveRequestUrl("http://logging.bunnycdn.com/x", BASE),
  ).toThrow("Refusing to send your API key");
});
