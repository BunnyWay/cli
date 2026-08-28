import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../../test-utils/temp-dir.ts";
import { majorFrom, requireSupportedAstro } from "./project.ts";

const tempDir = useTempDir("bunny-lab-astro-");

function project(astro: string | null): string {
  const dir = tempDir();
  mkdirSync(join(dir, "src", "pages"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "app",
      dependencies: astro === null ? {} : { astro },
    }),
  );
  return dir;
}

test("the major is read from the forms a package.json holds", () => {
  expect(majorFrom("^7.2.6")).toBe(7);
  expect(majorFrom("~7.2")).toBe(7);
  expect(majorFrom(">=7")).toBe(7);
  expect(majorFrom("7.2.6")).toBe(7);
  expect(majorFrom("5.16.10")).toBe(5);
  expect(majorFrom("11.0.0")).toBe(11);
});

// A range this cannot parse must not stop a deploy: the build is the real test,
// and `workspace:*` is a range every monorepo holds.
test("a range this cannot read does not stop the deploy", () => {
  expect(majorFrom("workspace:*")).toBeNull();
  expect(majorFrom("*")).toBeNull();
});

// `render-examples/astro-ssr` ships Astro 5, and `npm install` then refuses the
// adapter with an ERESOLVE about peer ranges. That error tells a developer
// nothing to act on, so the check happens before the install.
test("Astro 5 stops with the upgrade command", async () => {
  await expect(requireSupportedAstro(project("^5.16.10"))).rejects.toThrow(
    /uses Astro 5.*needs Astro 7/s,
  );
});

test("Astro 7 and newer pass", async () => {
  await expect(
    requireSupportedAstro(project("^7.2.6")),
  ).resolves.toBeUndefined();
  await expect(
    requireSupportedAstro(project("^8.0.0")),
  ).resolves.toBeUndefined();
});

test("a project without Astro says so", async () => {
  await expect(requireSupportedAstro(project(null))).rejects.toThrow(
    /does not depend on Astro/,
  );
});
