import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { loadSiteConfig, saveSiteConfig } from "./config.ts";

test("saveSiteConfig edits the sites block in place, keeping comments and siblings", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "sites-config-")),
    "bunny.jsonc",
  );
  await Bun.write(
    path,
    `{
  // keep me
  "version": "2026-05-11",
  "app": { "name": "api", "containers": {} },
  "sites": { "name": "my-site" }
}
`,
  );
  saveSiteConfig({ spa: false }, path);
  const text = readFileSync(path, "utf-8");
  expect(text).toContain("// keep me");
  expect(parseJsonc(text)).toEqual({
    version: "2026-05-11",
    app: { name: "api", containers: {} },
    sites: { name: "my-site", spa: false },
  });
});

test("loadSiteConfig(from) finds the bunny.jsonc above a nested deploy directory", async () => {
  const project = join(mkdtempSync(join(tmpdir(), "sites-config-")), "web");
  mkdirSync(join(project, "dist"), { recursive: true });
  await Bun.write(join(project, "bunny.jsonc"), `{ "sites": { "spa": true } }`);
  expect(loadSiteConfig(join(project, "dist"))).toEqual({
    config: { spa: true },
    root: project,
  });
});
