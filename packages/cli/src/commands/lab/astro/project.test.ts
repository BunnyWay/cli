import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAstroProjects, isAstroProject } from "./project.ts";

/** Build a tree from paths; a path ending in `/` is a directory. */
function tree(paths: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "bunny-project-"));
  for (const path of paths) {
    const full = join(root, path);
    if (path.endsWith("/")) {
      mkdirSync(full, { recursive: true });
      continue;
    }
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "");
  }
  return root;
}

test("a directory with an Astro config is a project", () => {
  expect(isAstroProject(tree(["astro.config.mjs"]))).toBe(true);
  expect(isAstroProject(tree(["astro.config.ts"]))).toBe(true);
});

// Astro needs no config file. A project with pages is still a project.
test("a directory with pages and no config is a project", () => {
  expect(isAstroProject(tree(["src/pages/index.astro"]))).toBe(true);
});

test("a workspace root is not a project", () => {
  expect(
    isAstroProject(tree(["package.json", "pnpm-workspace.yaml", "docs/"])),
  ).toBe(false);
});

// The shape of withastro/starlight: the site is docs/, and the examples are not.
test("finds the projects below a monorepo root, likeliest first", () => {
  const root = tree([
    "package.json",
    "pnpm-workspace.yaml",
    "docs/astro.config.mjs",
    "examples/basics/astro.config.mjs",
    "examples/tailwind/astro.config.mjs",
    "packages/starlight/package.json",
  ]);

  const found = findAstroProjects(root).map((candidate) => candidate.label);
  expect(found).toEqual(["docs", "examples/basics", "examples/tailwind"]);
});

test("looks inside apps/, and stops at the project it finds", () => {
  const root = tree([
    "package.json",
    "apps/web/astro.config.mjs",
    "apps/web/tests/fixtures/nested/astro.config.mjs",
    "apps/api/package.json",
  ]);

  expect(findAstroProjects(root).map((c) => c.label)).toEqual(["apps/web"]);
});

test("does not walk into node_modules", () => {
  const root = tree([
    "package.json",
    "node_modules/astro-thing/astro.config.mjs",
  ]);
  expect(findAstroProjects(root)).toEqual([]);
});

test("finds nothing when there is nothing", () => {
  expect(findAstroProjects(tree(["package.json", "src/index.ts"]))).toEqual([]);
});
