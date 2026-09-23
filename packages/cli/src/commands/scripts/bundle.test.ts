import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleEdgeScript } from "./bundle.ts";

let root: string;

function scaffold(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "bunny-bundle-test-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return join(root, "index.ts");
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("inlines dependencies and leaves runtime imports for Deno", async () => {
  const entry = scaffold({
    "node_modules/dep/package.json": '{"name":"dep","main":"index.js"}',
    "node_modules/dep/index.js":
      'const { createHash } = require("crypto");\nmodule.exports = () => createHash("sha1");',
    "index.ts": [
      'import process from "node:process";',
      'import { readFile } from "fs/promises";',
      'import { z } from "npm:zod@3";',
      'import dep from "dep";',
      "export default () => new Response(String([process, readFile, z, dep]));",
    ].join("\n"),
  });
  const { code, warnings } = await bundleEdgeScript({ entry, label: "test" });
  expect(code).toContain('from "node:process"');
  expect(code).toContain('from "node:fs/promises"');
  expect(code).toContain('from "node:crypto"');
  expect(code).toContain('from "npm:zod@3"');
  expect(code).toContain("module.exports = () =>");
  expect(warnings).toEqual([]);
});

test("rejects jsr, URL, and Bun imports", async () => {
  const entry = scaffold({
    "index.ts": [
      'import { a } from "jsr:@std/path";',
      'import { b } from "https://esm.sh/hono";',
      'import { Database } from "bun:sqlite";',
      "export default () => new Response(String([a, b, Database]));",
    ].join("\n"),
  });
  await expect(bundleEdgeScript({ entry, label: "test" })).rejects.toThrow(
    "test imports bun:sqlite, https://esm.sh/hono, jsr:@std/path",
  );
});

test("warns when the bundle references the Bun global", async () => {
  const entry = scaffold({
    "index.ts": "export default () => new Response(Bun.version);",
  });
  const { warnings } = await bundleEdgeScript({ entry, label: "test" });
  expect(warnings[0]).toContain("Bun global");
});
