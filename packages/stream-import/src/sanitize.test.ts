import { describe, expect, test } from "bun:test";
import {
  isHttpsUrl,
  isValidBunnyGuid,
  safeErrorMessage,
  sanitizeMetadata,
  sanitizeString,
  stripAnsi,
  trimTrailingSlashes,
} from "./sanitize.ts";

const ESC = "\u001B";

describe("sanitizeString", () => {
  test("strips ANSI escapes and control characters, then truncates", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[39m`)).toBe("red");
    expect(stripAnsi(`${ESC}[;5mblink`)).toBe("blink");
    expect(stripAnsi(`${ESC}]8;;https://x.test\u0007link`)).toBe("link");
    expect(sanitizeString(`evil\u0000title${ESC}[31m\n`)).toBe("eviltitle");
    expect(sanitizeString("x".repeat(600), 10)).toHaveLength(10);
  });

  // A hostile title of 20k semicolons after an escape took over a second with the old pattern.
  test("stays linear on an unterminated escape full of separators", () => {
    const started = performance.now();
    stripAnsi(`${ESC}${";".repeat(20_000)}`);
    stripAnsi(`${ESC}[${";".repeat(20_000)}`);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

test("trimTrailingSlashes drops every trailing slash and nothing else", () => {
  expect(trimTrailingSlashes("videos///")).toBe("videos");
  expect(trimTrailingSlashes("///")).toBe("");
  expect(trimTrailingSlashes("a/b")).toBe("a/b");
});

describe("sanitizeMetadata", () => {
  test("caps the description, the tag count, and each tag, dropping empty tags", () => {
    const out = sanitizeMetadata({
      description: "z".repeat(20_000),
      tags: Array.from({ length: 80 }, () => "y".repeat(150)),
    });
    expect(out.description).toHaveLength(10_000);
    expect(out.tags).toHaveLength(50);
    expect(out.tags?.[0]).toHaveLength(100);
    expect(sanitizeMetadata({ tags: ["ok", "\u0000"] }).tags).toEqual(["ok"]);
    expect(sanitizeMetadata({})).toEqual({});
  });
});

describe("safeErrorMessage", () => {
  test("redacts credentials wherever they appear", () => {
    const out = safeErrorMessage(
      new Error(
        "api_key=abc123 access_token=tok123 Bearer eyJhbGci password=hunter2 AKIAIOSFODNN7EXAMPLE",
      ),
      "Import failed",
    );
    expect(out).not.toMatch(
      /abc123|tok123|eyJhbGci|hunter2|AKIAIOSFODNN7EXAMPLE/,
    );
    expect(out).toContain("api_key=[REDACTED]");
  });

  test("collapses stack traces and node_modules paths, and handles non-Error values", () => {
    expect(
      safeErrorMessage(
        new Error("boom\n    at Object.<anonymous> (/app/index.js:1:1)"),
        "Import failed",
      ),
    ).toBe("Import failed: An internal error occurred");
    expect(
      safeErrorMessage(
        new Error("cannot find /app/node_modules/x/index.js"),
        "Fetch failed",
      ),
    ).toBe("Fetch failed: An internal error occurred");
    expect(safeErrorMessage("plain string", "Ctx")).toBe("plain string");
    expect(safeErrorMessage(undefined, "Ctx")).toBe(
      "Ctx: An internal error occurred",
    );
  });
});

describe("URL and GUID guards", () => {
  test("isHttpsUrl accepts only https and never throws", () => {
    expect(isHttpsUrl("https://example.com/a.mp4")).toBe(true);
    expect(isHttpsUrl("http://example.com/a.mp4")).toBe(false);
    expect(isHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });

  test("isValidBunnyGuid rejects path separators and over-long input", () => {
    expect(isValidBunnyGuid("b0c1d2e3-4f56-7890-abcd-ef1234567890")).toBe(true);
    expect(isValidBunnyGuid("../../etc/passwd")).toBe(false);
    expect(isValidBunnyGuid("a".repeat(65))).toBe(false);
  });
});
