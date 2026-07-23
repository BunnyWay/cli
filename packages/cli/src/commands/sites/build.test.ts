import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveAutoBuild,
  resolveRequestedBuild,
  runBuildCommand,
} from "./build.ts";

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-auto-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("resolveAutoBuild infers a detected framework's build and output dir", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { vite: "^6.0.0" },
    }),
    "pnpm-lock.yaml": "",
  });
  expect(await resolveAutoBuild(dir)).toEqual({
    command: "pnpm run build",
    label: "Vite",
    dir: "dist",
  });
});

test("resolveAutoBuild falls back to a package.json build script", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      scripts: { build: "tsc" },
    }),
  });
  expect(await resolveAutoBuild(dir)).toEqual({
    command: "npm run build",
    label: "a package.json build script",
  });
});

test("resolveAutoBuild returns null when nothing is detected", async () => {
  const dir = tempRepo({ "index.html": "<h1>hi</h1>" });
  expect(await resolveAutoBuild(dir)).toBeNull();

  const noBuildScript = tempRepo({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "echo" } }),
  });
  expect(await resolveAutoBuild(noBuildScript)).toBeNull();
});

test("resolveRequestedBuild prefers the flag command, keeping the detected dir", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { vite: "^6.0.0" },
    }),
  });
  expect(
    await resolveRequestedBuild("make site", "npm run build", dir),
  ).toEqual({ command: "make site", dir: "dist" });
});

test("resolveRequestedBuild falls back to the configured, then detected build", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { astro: "^5.0.0" },
    }),
  });
  expect(await resolveRequestedBuild("", "npm run build", dir)).toEqual({
    command: "npm run build",
    dir: "dist",
  });
  expect(await resolveRequestedBuild("", undefined, dir)).toEqual({
    command: "npm run build",
    label: "Astro",
    dir: "dist",
  });
});

test("resolveRequestedBuild throws when nothing is configured or detected", async () => {
  const dir = tempRepo({ "index.html": "<h1>hi</h1>" });
  await expect(resolveRequestedBuild("", undefined, dir)).rejects.toThrow(
    "No build command configured and none detected.",
  );
});

test("runBuildCommand passes env and throws on failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-build-"));
  const out = join(dir, "out.txt");

  await runBuildCommand(`printf %s "$MY_VAR" > ${JSON.stringify(out)}`, dir, {
    MY_VAR: "built",
  });
  expect(await Bun.file(out).text()).toBe("built");

  await expect(runBuildCommand("exit 3", dir, {})).rejects.toThrow(
    "exit code 3",
  );
});
