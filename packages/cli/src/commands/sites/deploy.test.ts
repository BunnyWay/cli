import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { SiteContext } from "./api.ts";
import { deployUrls, resolveDeployDir } from "./deploy.ts";

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

const siteWithDomain = (domain?: string) =>
  ({ state: { domain } }) as SiteContext;

test("deployUrls has no preview URL without a custom domain", () => {
  expect(
    deployUrls(siteWithDomain(undefined), "abc123", {
      systemHost: "site.b-cdn.net",
    }),
  ).toEqual({ production: "https://site.b-cdn.net", preview: undefined });
});

// Until the wildcard's certificate issues, an https preview URL fails TLS and a plaintext http one would expose traffic; the URL is reported as pending instead of reachable.
test("deployUrls holds the preview URL as pending until the wildcard certificate issued", () => {
  const site = siteWithDomain("example.com");
  expect(deployUrls(site, "abc123", { previewSecure: true }).preview).toBe(
    "https://dpl-abc123.preview.example.com",
  );
  const pending = deployUrls(site, "abc123", { previewSecure: false });
  expect(pending.preview).toBeUndefined();
  expect(pending.previewPending).toBe(
    "https://dpl-abc123.preview.example.com",
  );
  // Zone unreadable: fall back to https rather than downgrading a working preview.
  expect(deployUrls(site, "abc123", {}).preview).toBe(
    "https://dpl-abc123.preview.example.com",
  );
});
