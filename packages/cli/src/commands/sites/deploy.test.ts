import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { DeployRecord, RemoteSiteState } from "./constants.ts";
import {
  productionUrl,
  resolveDeployDir,
  resolveDeployTarget,
} from "./deploy.ts";
import type { DeployIdentity } from "./deploy-id.ts";

const ROOT = "/project/root";

test("a CLI path arg is cwd-relative and wins over the configured dir", () => {
  expect(resolveDeployDir("out", "dist", undefined, ROOT)).toBe(resolve("out"));
});

test("`sites.dir` resolves against the bunny.jsonc root, not cwd", () => {
  expect(resolveDeployDir(undefined, "dist", undefined, ROOT)).toBe(
    `${ROOT}/dist`,
  );
});

test("the detected framework output dir resolves against the root where the build ran", () => {
  expect(resolveDeployDir(undefined, undefined, "public", ROOT)).toBe(
    `${ROOT}/public`,
  );
});

test("nothing specified falls back to the root, not cwd", () => {
  expect(resolveDeployDir(undefined, undefined, undefined, ROOT)).toBe(ROOT);
});

const stateWithDomain = (domain?: string) => ({ domain }) as RemoteSiteState;

test("productionUrl prefers the custom domain over the system host", () => {
  expect(productionUrl(stateWithDomain("example.com"), "site.b-cdn.net")).toBe(
    "https://example.com",
  );
  expect(productionUrl(stateWithDomain(undefined), "site.b-cdn.net")).toBe(
    "https://site.b-cdn.net",
  );
});

test("productionUrl is undefined when the site has neither a domain nor a system host", () => {
  expect(productionUrl(stateWithDomain(undefined), undefined)).toBeUndefined();
});

const deploy = (
  id: string,
  contentHash: string,
  source: DeployRecord["source"] = "content",
): DeployRecord => ({
  id,
  createdAt: "2026-08-27T00:00:00.000Z",
  source,
  contentHash,
  files: 1,
  bytes: 10,
});

const identity = (
  id: string,
  contentHash: string,
  source: DeployIdentity["source"] = "content",
): DeployIdentity => ({ id, source, contentHash });

describe("resolveDeployTarget", () => {
  test("unchanged content reuses the existing deploy and skips the upload", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("aaaa1111", "hash1")],
      identity: identity("aaaa1111", "hash1"),
      force: false,
    });
    expect(target).toEqual({ deployId: "aaaa1111", skipUpload: true });
  });

  test("without a custom id, matching content aliases onto the earlier deploy's id", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("aaaa1111", "hash1")],
      identity: identity("bbbb2222", "hash1", "git"),
      force: false,
    });
    expect(target.deployId).toBe("aaaa1111");
    expect(target.skipUpload).toBe(true);
  });

  // A catalog release must keep its own ID even when the bytes happen to match the last one.
  test("a custom id never aliases onto a different deploy that shares content", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("r41", "hash1")],
      identity: identity("r42", "hash1", "custom"),
      customId: "r42",
      force: false,
    });
    expect(target.deployId).toBe("r42");
    expect(target.skipUpload).toBe(false);
    expect(target.conflict).toBeUndefined();
  });

  test("redeploying a custom id with identical content is a no-op", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("r42", "hash1", "custom")],
      identity: identity("r42", "hash1", "custom"),
      customId: "r42",
      force: false,
    });
    expect(target).toEqual({ deployId: "r42", skipUpload: true });
  });

  test("reusing a custom id for different content is a conflict, not a silent overwrite", () => {
    const existing = deploy("r42", "hash1", "custom");
    const target = resolveDeployTarget({
      deploys: [existing],
      identity: identity("r42", "hash2", "custom"),
      customId: "r42",
      force: false,
    });
    expect(target.conflict).toEqual({ record: existing, reason: "content" });
    expect(target.deployId).toBe("r42");
  });

  test("a custom id is used exactly as given, case and all", () => {
    const target = resolveDeployTarget({
      deploys: [],
      identity: identity("Release-42", "hash1", "custom"),
      customId: "Release-42",
      force: false,
    });
    expect(target.deployId).toBe("Release-42");
    expect(target.conflict).toBeUndefined();
  });

  // Two deploys whose storage paths differ only by case are indistinguishable to anything that folds case.
  test("an id differing from an existing deploy only in case is refused", () => {
    const existing = deploy("Release-42", "hash1", "custom");
    const target = resolveDeployTarget({
      deploys: [existing],
      identity: identity("release-42", "hash2", "custom"),
      customId: "release-42",
      force: false,
    });
    expect(target.conflict).toEqual({ record: existing, reason: "case" });
  });

  test("--force does not override a case-variant conflict", () => {
    const existing = deploy("Release-42", "hash1", "custom");
    const target = resolveDeployTarget({
      deploys: [existing],
      identity: identity("release-42", "hash2", "custom"),
      customId: "release-42",
      force: true,
    });
    expect(target.conflict).toEqual({ record: existing, reason: "case" });
  });

  test("reusing the exact existing casing is a normal redeploy, not a case conflict", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("Release-42", "hash1", "custom")],
      identity: identity("Release-42", "hash1", "custom"),
      customId: "Release-42",
      force: false,
    });
    expect(target).toEqual({ deployId: "Release-42", skipUpload: true });
  });

  test("--force overrides the conflict and forces a fresh upload", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("r42", "hash1", "custom")],
      identity: identity("r42", "hash2", "custom"),
      customId: "r42",
      force: true,
    });
    expect(target.conflict).toBeUndefined();
    expect(target.skipUpload).toBe(false);
    expect(target.deployId).toBe("r42");
  });

  test("--force redeploys unchanged content under the same id", () => {
    const target = resolveDeployTarget({
      deploys: [deploy("r42", "hash1", "custom")],
      identity: identity("r42", "hash1", "custom"),
      customId: "r42",
      force: true,
    });
    expect(target.skipUpload).toBe(false);
    expect(target.deployId).toBe("r42");
  });

  test("a brand new custom id on an empty site just uploads", () => {
    const target = resolveDeployTarget({
      deploys: [],
      identity: identity("20260827-1433-r42", "hash1", "custom"),
      customId: "20260827-1433-r42",
      force: false,
    });
    expect(target).toEqual({
      deployId: "20260827-1433-r42",
      skipUpload: false,
    });
  });
});
