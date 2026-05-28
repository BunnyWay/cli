import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../test-utils/temp-dir.ts";
import { detectFromLockfile, detectFromUserAgent } from "./package-manager.ts";

describe("detectFromLockfile", () => {
  const tempDir = useTempDir("bunny-pm-lock-");

  test("returns null when no lockfile is present", () => {
    expect(detectFromLockfile(tempDir())).toBeNull();
  });

  test.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ])("maps %s → %s", (filename, expected) => {
    writeFileSync(join(tempDir(), filename), "");
    expect(detectFromLockfile(tempDir())).toBe(expected as never);
  });

  test("prefers bun.lock when both bun and npm lockfiles exist", () => {
    writeFileSync(join(tempDir(), "bun.lock"), "");
    writeFileSync(join(tempDir(), "package-lock.json"), "{}");
    expect(detectFromLockfile(tempDir())).toBe("bun");
  });
});

describe("detectFromUserAgent", () => {
  test("returns null for undefined", () => {
    expect(detectFromUserAgent(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(detectFromUserAgent("")).toBeNull();
  });

  test.each([
    ["npm/10.2.4 node/v20.10.0 darwin arm64 workspaces/false", "npm"],
    ["bun/1.3.1 (darwin arm64)", "bun"],
    ["pnpm/9.0.0 npm/? node/v20.10.0 darwin arm64", "pnpm"],
    ["yarn/1.22.22 npm/? node/v20.10.0 darwin arm64", "yarn"],
  ])("parses %j → %j", (ua, expected) => {
    expect(detectFromUserAgent(ua)).toBe(expected as never);
  });

  test("is case-insensitive on the PM name", () => {
    expect(detectFromUserAgent("BUN/1.3.1")).toBe("bun");
  });

  test("returns null for an unrecognised PM", () => {
    expect(detectFromUserAgent("deno/1.0.0")).toBeNull();
  });
});
