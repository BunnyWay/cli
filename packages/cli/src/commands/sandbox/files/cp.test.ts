import { describe, expect, test } from "bun:test";
import { resolveCopyDest } from "./cp.ts";

describe("resolveCopyDest", () => {
  test("a trailing slash appends the source filename without probing", async () => {
    const path = await resolveCopyDest("/tmp/", "app.js", () => {
      throw new Error("should not probe");
    });
    expect(path).toBe("/tmp/app.js");
  });

  test("an existing directory appends the source filename", async () => {
    expect(await resolveCopyDest("/tmp", "app.js", async () => true)).toBe(
      "/tmp/app.js",
    );
  });

  test("a file or missing destination is used as-is", async () => {
    expect(
      await resolveCopyDest("/tmp/app.js", "app.js", async () => false),
    ).toBe("/tmp/app.js");
  });

  test("relative directory destinations work too", async () => {
    expect(await resolveCopyDest("src", "app.js", async () => true)).toBe(
      "src/app.js",
    );
  });
});
