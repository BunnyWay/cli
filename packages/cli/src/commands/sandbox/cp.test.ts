import { describe, expect, test } from "bun:test";
import { parseRemoteRef } from "./cp.ts";

describe("parseRemoteRef", () => {
  test("parses a sandbox reference with an absolute path", () => {
    expect(parseRemoteRef("my-sandbox:/workplace/app.js")).toEqual({
      sandbox: "my-sandbox",
      path: "/workplace/app.js",
    });
  });

  test("parses a sandbox reference with a relative path", () => {
    expect(parseRemoteRef("my-sandbox:app.js")).toEqual({
      sandbox: "my-sandbox",
      path: "app.js",
    });
  });

  test("treats a bare local path as local", () => {
    expect(parseRemoteRef("./app.js")).toBeNull();
    expect(parseRemoteRef("/tmp/app.js")).toBeNull();
    expect(parseRemoteRef("app.js")).toBeNull();
  });

  test("rejects prefixes that look like directories, not sandbox names", () => {
    expect(parseRemoteRef("./dir:file")).toBeNull();
    expect(parseRemoteRef("~/dir:file")).toBeNull();
    expect(parseRemoteRef("a/b:file")).toBeNull();
  });

  test("requires a non-empty path after the colon", () => {
    expect(parseRemoteRef("my-sandbox:")).toBeNull();
  });
});
