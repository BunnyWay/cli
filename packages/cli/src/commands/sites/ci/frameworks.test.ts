import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectFramework,
  detectPackageManager,
  detectWorkspace,
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

test("detectFramework spots Gatsby, Nuxt, and SolidStart", async () => {
  const gatsby = tempRepo({ "package.json": pkg({ gatsby: "^5.0.0" }) });
  expect((await detectFramework(gatsby))?.id).toBe("gatsby");

  const nuxt = tempRepo({
    "package.json": pkg({ nuxt: "^3.0.0", vite: "^6.0.0" }),
  });
  expect((await detectFramework(nuxt))?.id).toBe("nuxt");

  const solid = tempRepo({
    "package.json": pkg({ "@solidjs/start": "^1.0.0" }),
  });
  expect((await detectFramework(solid))?.id).toBe("solidstart");
});

test("detectFramework spots the Python doc SSGs", async () => {
  expect(
    (await detectFramework(tempRepo({ "mkdocs.yml": "site_name: x" })))?.id,
  ).toBe("mkdocs");
  expect(
    (await detectFramework(tempRepo({ "pelicanconf.py": "AUTHOR = 'x'" })))?.id,
  ).toBe("pelican");
  expect(
    (await detectFramework(tempRepo({ "conf.py": "project = 'x'" })))?.id,
  ).toBe("sphinx");
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

test("detectFramework spots Jekyll from the Gemfile or _config.yml", async () => {
  const gemfile = tempRepo({ Gemfile: 'gem "jekyll", "~> 4.3"' });
  expect((await detectFramework(gemfile))?.id).toBe("jekyll");

  const config = tempRepo({ "_config.yml": "title: My Site" });
  expect((await detectFramework(config))?.id).toBe("jekyll");
});

test("detectFramework spots Hugo from hugo.toml", async () => {
  const dir = tempRepo({ "hugo.toml": 'title = "My Site"' });
  expect((await detectFramework(dir))?.id).toBe("hugo");
});

test("detectFramework is undefined for unknown projects", async () => {
  const dir = tempRepo({ "index.html": "<h1>hi</h1>" });
  expect(await detectFramework(dir)).toBeUndefined();
});

test("presetBuildCommand runs the package.json build for plain js presets", () => {
  const vite = findPreset("vite");
  expect(presetBuildCommand(vite as never, "pnpm")).toBe("pnpm run build");
});

test("presetBuildCommand runs an explicit js build via the package runner", () => {
  const nuxt = findPreset("nuxt");
  expect(presetBuildCommand(nuxt as never, "bun")).toBe("bunx nuxi generate");
  expect(presetBuildCommand(nuxt as never, "npm")).toBe("npx nuxi generate");
});

test("presetBuildCommand runs non-js builds directly", () => {
  const hugo = findPreset("hugo");
  expect(presetBuildCommand(hugo as never, "npm")).toBe("hugo --minify");
});

test("presetBuildCommand returns null for the static preset", () => {
  const staticPreset = findPreset("static");
  expect(presetBuildCommand(staticPreset as never, "npm")).toBeNull();
});

test("detectPackageManager reads the lockfile", async () => {
  expect(await detectPackageManager(tempRepo({ "bun.lock": "" }))).toBe("bun");
  expect(await detectPackageManager(tempRepo({ "bun.lockb": "" }))).toBe("bun");
  expect(await detectPackageManager(tempRepo({ "pnpm-lock.yaml": "" }))).toBe(
    "pnpm",
  );
  expect(await detectPackageManager(tempRepo({ "yarn.lock": "" }))).toBe(
    "yarn",
  );
  expect(await detectPackageManager(tempRepo({}))).toBe("npm");
});

// The lockfile is at the root of a monorepo, not beside each package. Reading
// only the package made `starlight/docs` look like an npm project, and `npm
// install` then met `"@astrojs/starlight": "workspace:*"` and stopped.
test("detectWorkspace finds the package manager up the tree", async () => {
  const root = tempRepo({
    "pnpm-lock.yaml": "",
    "pnpm-workspace.yaml": "packages:\n  - 'docs'\n",
    "package.json": JSON.stringify({ name: "root", private: true }),
  });
  const docs = join(root, "docs");
  mkdirSync(docs);
  writeFileSync(join(docs, "package.json"), pkg({ astro: "^7.0.0" }));

  const workspace = await detectWorkspace(docs);
  expect(workspace.pm).toBe("pnpm");
  expect(workspace.root).toBe(root);
  // The package is not the workspace root, so `pnpm add` needs no `-w`.
  expect(workspace.isRoot).toBe(false);
});

test("detectWorkspace knows when the project is the workspace root", async () => {
  const root = tempRepo({
    "pnpm-lock.yaml": "",
    "pnpm-workspace.yaml": "packages:\n  - 'packages/**'\n",
    "package.json": JSON.stringify({ name: "root", private: true }),
  });
  expect((await detectWorkspace(root)).isRoot).toBe(true);
});

// astro.build has a pnpm-workspace.yaml holding only settings, and `pnpm add`
// works there without `-w`.
test("detectWorkspace does not call a settings-only pnpm-workspace.yaml a root", async () => {
  const root = tempRepo({
    "pnpm-lock.yaml": "",
    "pnpm-workspace.yaml": "minimumReleaseAge: 4320\n",
    "package.json": pkg({ astro: "^7.0.0" }),
  });
  expect((await detectWorkspace(root)).isRoot).toBe(false);
});

test("detectWorkspace reads npm and yarn workspaces too", async () => {
  const npmRoot = tempRepo({
    "package-lock.json": "{}",
    "package.json": JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
  });
  const npm = await detectWorkspace(npmRoot);
  expect(npm.pm).toBe("npm");
  expect(npm.isRoot).toBe(true);

  const yarnRoot = tempRepo({
    "yarn.lock": "",
    "package.json": JSON.stringify({
      name: "root",
      workspaces: { packages: ["apps/*"] },
    }),
  });
  const yarn = await detectWorkspace(yarnRoot);
  expect(yarn.pm).toBe("yarn");
  expect(yarn.isRoot).toBe(true);
});

test("detectPackageManager still answers npm when nothing says otherwise", async () => {
  const dir = tempRepo({ "package.json": pkg({ astro: "^7.0.0" }) });
  expect(await detectPackageManager(dir)).toBe("npm");
});
