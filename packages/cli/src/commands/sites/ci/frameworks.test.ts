import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectFramework,
  detectPackageManager,
  findPreset,
  presetBuildCommand,
} from "./frameworks.ts";

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-ci-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function pkg(deps: Record<string, string>): string {
  return JSON.stringify({ name: "x", dependencies: deps });
}

test("detectFramework picks meta-frameworks over vite", async () => {
  const dir = tempRepo({
    "package.json": pkg({ vite: "^6.0.0", astro: "^5.0.0" }),
  });
  expect((await detectFramework(dir))?.id).toBe("astro");
});

test("detectFramework finds React Router via @react-router/dev", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { react: "^19.0.0" },
      devDependencies: { "@react-router/dev": "^7.0.0", vite: "^6.0.0" },
    }),
  });
  const preset = await detectFramework(dir);
  expect(preset?.id).toBe("react-router");
  expect(preset?.dir).toBe("build/client");
});

test("detectFramework falls back to vite for plain vite apps", async () => {
  const dir = tempRepo({ "package.json": pkg({ vite: "^6.0.0" }) });
  expect((await detectFramework(dir))?.id).toBe("vite");
});

test("detectFramework distinguishes Zola from Hugo via templates/", async () => {
  const zola = mkdtempSync(join(tmpdir(), "bunny-sites-ci-"));
  writeFileSync(join(zola, "config.toml"), 'base_url = "https://example.com"');
  mkdirSync(join(zola, "templates"));
  expect((await detectFramework(zola))?.id).toBe("zola");

  const hugo = mkdtempSync(join(tmpdir(), "bunny-sites-ci-"));
  writeFileSync(join(hugo, "config.toml"), 'title = "x"');
  mkdirSync(join(hugo, "content"));
  expect((await detectFramework(hugo))?.id).toBe("hugo");
});

test("detectFramework is undefined for unknown projects", async () => {
  const dir = tempRepo({ "index.html": "<h1>hi</h1>" });
  expect(await detectFramework(dir)).toBeUndefined();
});

test("presetBuildCommand: package.json build, runner exec for overrides, direct for non-js, none for static", () => {
  const cmd = (id: string, pm: "npm" | "pnpm" | "bun") =>
    presetBuildCommand(findPreset(id) as never, pm);
  expect(cmd("vite", "pnpm")).toBe("pnpm run build");
  expect(cmd("nuxt", "bun")).toBe("bunx nuxi generate");
  expect(cmd("hugo", "npm")).toBe("hugo --minify");
  expect(cmd("static", "npm")).toBeNull();
});

test("detectPackageManager reads the lockfile", async () => {
  expect(await detectPackageManager(tempRepo({ "bun.lock": "" }))).toBe("bun");
  expect(await detectPackageManager(tempRepo({ "pnpm-lock.yaml": "" }))).toBe(
    "pnpm",
  );
  expect(await detectPackageManager(tempRepo({}))).toBe("npm");
});
