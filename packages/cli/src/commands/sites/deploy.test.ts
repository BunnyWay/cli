import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { RemoteSiteState } from "./constants.ts";
import { productionUrl, resolveDeployDir } from "./deploy.ts";

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
