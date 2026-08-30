import { expect, test } from "bun:test";
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

test("matching content skips the upload, aliasing onto the existing deploy's id", () => {
  const deploys = [deploy("aaaa1111", "hash1")];

  expect(
    resolveDeployTarget({
      deploys,
      identity: identity("aaaa1111", "hash1"),
      force: false,
    }),
  ).toEqual({ deployId: "aaaa1111", skipUpload: true });

  // A different git sha over identical bytes reuses the earlier deploy rather than duplicating it.
  expect(
    resolveDeployTarget({
      deploys,
      identity: identity("bbbb2222", "hash1", "git"),
      force: false,
    }),
  ).toEqual({ deployId: "aaaa1111", skipUpload: true });
});

// A catalog release must keep its own ID even when the bytes match another deploy.
test("a custom id is used exactly as given and never aliases onto another deploy", () => {
  expect(
    resolveDeployTarget({
      deploys: [deploy("r41", "hash1")],
      identity: identity("r42", "hash1", "custom"),
      customId: "r42",
      force: false,
    }),
  ).toEqual({ deployId: "r42", skipUpload: false });

  // Same id, same content: a no-op redeploy.
  expect(
    resolveDeployTarget({
      deploys: [deploy("Release-42", "hash1", "custom")],
      identity: identity("Release-42", "hash1", "custom"),
      customId: "Release-42",
      force: false,
    }),
  ).toEqual({ deployId: "Release-42", skipUpload: true });
});

// The handler resolves a content conflict by asking (--force answers yes), so it is reported regardless of force.
test("reusing a custom id for different content conflicts instead of overwriting", () => {
  const existing = deploy("r42", "hash1", "custom");
  for (const force of [false, true]) {
    const target = resolveDeployTarget({
      deploys: [existing],
      identity: identity("r42", "hash2", "custom"),
      customId: "r42",
      force,
    });
    expect(target.conflict).toEqual({ record: existing, reason: "content" });
  }
});

// Two deploys whose storage paths differ only by case are indistinguishable to anything that folds case,
// so this one conflict stands even under --force.
test("an id differing only in case is refused, with or without --force", () => {
  const existing = deploy("Release-42", "hash1", "custom");
  const args = {
    deploys: [existing],
    identity: identity("release-42", "hash2", "custom"),
    customId: "release-42",
  };
  const conflict = { record: existing, reason: "case" } as const;

  expect(resolveDeployTarget({ ...args, force: false }).conflict).toEqual(
    conflict,
  );
  expect(resolveDeployTarget({ ...args, force: true }).conflict).toEqual(
    conflict,
  );
});

// Replacing the deploy production serves (or the rollback target) rewrites its prefix while the router reads it, so it is never forceable — custom ID or not.
test("replacing the live or rollback deploy's content is refused, even with --force", () => {
  const live = deploy("r42", "hash1", "custom");
  const args = {
    deploys: [live],
    identity: identity("r42", "hash2", "custom"),
    customId: "r42",
    force: true,
  };
  expect(resolveDeployTarget({ ...args, current: "r42" }).conflict).toEqual({
    record: live,
    reason: "live",
  });
  expect(resolveDeployTarget({ ...args, previous: "r42" }).conflict).toEqual({
    record: live,
    reason: "rollback",
  });

  // Same git sha over different bytes lands on the same ID without --deploy-id.
  const gitLive = deploy("aaaa1111", "hash1", "git");
  expect(
    resolveDeployTarget({
      deploys: [gitLive],
      identity: identity("aaaa1111", "hash2", "git"),
      force: false,
      current: "aaaa1111",
    }).conflict,
  ).toEqual({ record: gitLive, reason: "live" });
});

// --force's "redeploy unchanged content" path: every write is byte-identical, so in-place is safe.
test("a forced same-content redeploy of the live deploy is allowed", () => {
  expect(
    resolveDeployTarget({
      deploys: [deploy("r42", "hash1", "custom")],
      identity: identity("r42", "hash1", "custom"),
      customId: "r42",
      force: true,
      current: "r42",
    }),
  ).toEqual({ deployId: "r42", skipUpload: false });
});

test("a brand new custom id on an empty site just uploads", () => {
  expect(
    resolveDeployTarget({
      deploys: [],
      identity: identity("20260827-1433-r42", "hash1", "custom"),
      customId: "20260827-1433-r42",
      force: false,
    }),
  ).toEqual({ deployId: "20260827-1433-r42", skipUpload: false });
});
