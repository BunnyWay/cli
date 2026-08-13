import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { RemoteSiteState } from "./constants.ts";
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

const stateWithDomain = (domain?: string) => ({ domain }) as RemoteSiteState;

test("deployUrls: production prefers the custom domain over the system host", () => {
  expect(
    deployUrls(stateWithDomain("example.com"), undefined, "site.b-cdn.net"),
  ).toEqual({ production: "https://example.com", preview: undefined });
  expect(
    deployUrls(stateWithDomain(undefined), undefined, "site.b-cdn.net"),
  ).toEqual({ production: "https://site.b-cdn.net", preview: undefined });
});

test("deployUrls: the preview URL comes from the deploy's own zone and needs no domain", () => {
  expect(
    deployUrls(
      stateWithDomain(undefined),
      { previewHost: "sites-dpl-abc123-x1y2z3.b-cdn.net" },
      "site.b-cdn.net",
    ),
  ).toEqual({
    production: "https://site.b-cdn.net",
    preview: "https://sites-dpl-abc123-x1y2z3.b-cdn.net",
  });
  // A record without a zone (creation failed, or an older CLI wrote it) simply has no preview URL.
  expect(deployUrls(stateWithDomain(undefined), {}, undefined)).toEqual({
    production: undefined,
    preview: undefined,
  });
});
