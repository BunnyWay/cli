import { expect, test } from "bun:test";
import { patchAstroConfig, vendorAdapterIn } from "./adapter.ts";

const PKG = "@bunny.net/astro-adapter";

test("adds the import and the adapter to a fresh config", () => {
  const source = [
    "// @ts-check",
    'import { defineConfig } from "astro/config";',
    "",
    "export default defineConfig({});",
    "",
  ].join("\n");

  const patched = patchAstroConfig(source, PKG)?.source;
  expect(patched).toContain('import bunny from "@bunny.net/astro-adapter";');
  expect(patched).toContain("adapter: bunny()");
  // The import goes after the last existing one, not above the file's comment.
  expect(patched?.indexOf("// @ts-check")).toBe(0);
});

// Since Astro 5, a project that says nothing prerenders its pages, and a page
// asks for the edge with `export const prerender = false`. Setting
// `output: "server"` here took astro.build's script from 7.83 MB to 22.30 MB.
test("never sets output", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    "export default defineConfig({});",
  ].join("\n");

  expect(patchAstroConfig(source, PKG)?.source).not.toContain("output");
});

test("keeps existing options, and adds the adapter beside them", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    'import sitemap from "@astrojs/sitemap";',
    "",
    "export default defineConfig({",
    "  site: https://example.com,",
    "  integrations: [sitemap()],",
    "});",
  ].join("\n");

  const patched = patchAstroConfig(source, PKG)?.source;
  expect(patched).toContain("integrations: [sitemap()]");
  expect(patched).toContain("adapter: bunny()");
  // The adapter's import lands after the last one, so nothing is shadowed.
  const importEnd = patched?.lastIndexOf("import ") ?? -1;
  expect(patched?.slice(importEnd)).toContain("bunny");
});

// Moving to bunny.net from another host is the commonest first deploy there is.
test("replaces another vendor's adapter, and says which one", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    "import cloudflare from '@astrojs/cloudflare';",
    'import sitemap from "@astrojs/sitemap";',
    "export default defineConfig({",
    "  integrations: [sitemap()],",
    "  adapter: cloudflare({",
    "    imageService: 'cloudflare-binding',",
    "  }),",
    "});",
  ].join("\n");

  const patch = patchAstroConfig(source, PKG);
  expect(patch?.replaced).toBe("@astrojs/cloudflare");
  // The name follows the package: `cloudflare()` pointing at bunny.net would
  // work, and would read like a mistake.
  expect(patch?.source).toContain(
    'import bunny from "@bunny.net/astro-adapter";',
  );
  expect(patch?.source).toContain("adapter: bunny(),");
  expect(patch?.source).not.toContain("cloudflare");
  expect(patch?.source).not.toContain("cloudflare-binding");
  // Nothing else moved.
  expect(patch?.source).toContain("integrations: [sitemap()]");
});

// A file that already has a `bunny` keeps its own name, so nothing is shadowed.
test("keeps the old name when bunny is taken", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    'import node from "@astrojs/node";',
    "const bunny = 1;",
    "export default defineConfig({",
    "  adapter: node(),",
    "});",
  ].join("\n");

  const patch = patchAstroConfig(source, PKG);
  expect(patch?.source).toContain(
    'import node from "@bunny.net/astro-adapter";',
  );
  expect(patch?.source).toContain("adapter: node(),");
});

test("replaces an adapter whose options span nothing at all", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    'import node from "@astrojs/node";',
    "export default defineConfig({",
    '  adapter: node({ mode: "standalone" }),',
    "});",
  ].join("\n");

  const patch = patchAstroConfig(source, PKG);
  expect(patch?.replaced).toBe("@astrojs/node");
  expect(patch?.source).not.toContain("standalone");
});

// An adapter nobody has heard of is somebody's decision, so this refuses rather
// than fights. The CLI then names the file and quotes the lines to write.
test("refuses to replace an adapter it does not know", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    'import mystery from "astro-adapter-mystery";',
    "export default defineConfig({",
    "  adapter: mystery(),",
    "});",
  ].join("\n");

  expect(patchAstroConfig(source, PKG)).toBeNull();
});

test("changes nothing when the adapter is already configured", () => {
  const source = [
    'import { defineConfig } from "astro/config";',
    'import bunny from "@bunny.net/astro-adapter";',
    "export default defineConfig({",
    "  adapter: bunny(),",
    "});",
  ].join("\n");

  expect(patchAstroConfig(source, PKG)?.source).toBe(source);
});

// Anything this cannot read safely is left alone, and the CLI prints the snippet.
test("refuses a config it cannot read", () => {
  expect(patchAstroConfig("export default makeConfig();", PKG)).toBeNull();
  expect(patchAstroConfig("export default defineConfig({});", PKG)).toBeNull();
});

test("names the adapter in the way, so the prompt can say it", () => {
  const cloudflare = [
    "import cloudflare from '@astrojs/cloudflare';",
    "export default defineConfig({",
    "  adapter: cloudflare(),",
    "});",
  ].join("\n");
  expect(vendorAdapterIn(cloudflare)).toBe("@astrojs/cloudflare");

  const none = [
    "export default defineConfig({",
    "  site: 'https://example.com',",
    "});",
  ].join("\n");
  expect(vendorAdapterIn(none)).toBeUndefined();
});
