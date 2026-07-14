import { access } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface FrameworkPreset {
  id: string;
  label: string;
  /** Directory the build writes, relative to the repo root; the deploy target. */
  dir: string;
  /** Which setup/build steps the workflow needs. */
  toolchain: "js" | "ruby" | "hugo" | "python" | "zola" | "dotnet" | "none";
  /** Explicit build command; js presets run it via the package manager, others run it directly. Omit on js to run the package.json `build` script. */
  build?: string;
}

// Static must stay last: the interactive prompt defaults to it.
export const FRAMEWORK_PRESETS: FrameworkPreset[] = [
  { id: "analog", label: "Analog", dir: "dist/analog/public", toolchain: "js" },
  // Angular's application builder emits dist/<project>/browser; adjust if yours differs.
  { id: "angular", label: "Angular", dir: "dist", toolchain: "js" },
  { id: "astro", label: "Astro", dir: "dist", toolchain: "js" },
  {
    id: "brunch",
    label: "Brunch",
    dir: "public",
    toolchain: "js",
    build: "brunch build --production",
  },
  { id: "docusaurus", label: "Docusaurus", dir: "build", toolchain: "js" },
  { id: "elderjs", label: "Elder.js", dir: "public", toolchain: "js" },
  { id: "eleventy", label: "Eleventy", dir: "_site", toolchain: "js" },
  { id: "ember", label: "Ember", dir: "dist", toolchain: "js" },
  { id: "gatsby", label: "Gatsby", dir: "public", toolchain: "js" },
  { id: "gridsome", label: "Gridsome", dir: "dist", toolchain: "js" },
  {
    id: "hexo",
    label: "Hexo",
    dir: "public",
    toolchain: "js",
    build: "hexo generate",
  },
  { id: "next", label: "Next.js (static export)", dir: "out", toolchain: "js" },
  {
    id: "nuxt",
    label: "Nuxt (static generate)",
    dir: ".output/public",
    toolchain: "js",
    build: "nuxi generate",
  },
  { id: "preact", label: "Preact (preact-cli)", dir: "build", toolchain: "js" },
  { id: "qwik", label: "Qwik (static adapter)", dir: "dist", toolchain: "js" },
  {
    id: "react",
    label: "React (Create React App)",
    dir: "build",
    toolchain: "js",
  },
  {
    id: "react-router",
    label: "React Router",
    dir: "build/client",
    toolchain: "js",
  },
  {
    id: "solidstart",
    label: "SolidStart (static preset)",
    dir: ".output/public",
    toolchain: "js",
  },
  {
    id: "sveltekit",
    label: "SvelteKit (adapter-static)",
    dir: "build",
    toolchain: "js",
  },
  { id: "vite", label: "Vite", dir: "dist", toolchain: "js" },
  {
    id: "vitepress",
    label: "VitePress",
    dir: ".vitepress/dist",
    toolchain: "js",
  },
  { id: "vue", label: "Vue (Vue CLI)", dir: "dist", toolchain: "js" },
  {
    id: "jekyll",
    label: "Jekyll",
    dir: "_site",
    toolchain: "ruby",
    build: "bundle exec jekyll build",
  },
  {
    id: "hugo",
    label: "Hugo",
    dir: "public",
    toolchain: "hugo",
    build: "hugo --minify",
  },
  {
    id: "mkdocs",
    label: "MkDocs",
    dir: "site",
    toolchain: "python",
    build: "mkdocs build",
  },
  {
    id: "pelican",
    label: "Pelican",
    dir: "output",
    toolchain: "python",
    build: "pelican content",
  },
  {
    id: "sphinx",
    label: "Sphinx",
    dir: "_build/html",
    toolchain: "python",
    build: "sphinx-build -b html . _build/html",
  },
  {
    id: "zola",
    label: "Zola",
    dir: "public",
    toolchain: "zola",
    build: "zola build",
  },
  // Blazor WebAssembly publishes to bin/Release/net<ver>/publish/wwwroot; bump the version if needed.
  {
    id: "blazor",
    label: "Blazor WebAssembly",
    dir: "bin/Release/net8.0/publish/wwwroot",
    toolchain: "dotnet",
    build: "dotnet publish -c Release",
  },
  {
    id: "static",
    label: "Static HTML (no build step)",
    dir: ".",
    toolchain: "none",
  },
];

export function findPreset(id: string): FrameworkPreset | undefined {
  return FRAMEWORK_PRESETS.find((p) => p.id === id);
}

// Runner for a project-local binary, mirroring the CI workflow's PM_EXEC.
const PM_EXEC: Record<PackageManager, string> = {
  bun: "bunx",
  pnpm: "pnpm exec",
  yarn: "yarn",
  npm: "npx",
};

/** The build command to run locally for a preset, or null for the static (no-build) preset. */
export function presetBuildCommand(
  preset: FrameworkPreset,
  pm: PackageManager,
): string | null {
  if (preset.toolchain === "none") return null;
  if (preset.toolchain === "js") {
    return preset.build ? `${PM_EXEC[pm]} ${preset.build}` : `${pm} run build`;
  }
  return preset.build ?? null;
}

// Ordered most-specific first: meta-frameworks depend on vite, so vite goes last.
// Blazor's compiled toolchain is selectable via --framework but not auto-detected.
const JS_DETECTORS: Array<[dependency: string, presetId: string]> = [
  ["@analogjs/platform", "analog"],
  ["astro", "astro"],
  ["@react-router/dev", "react-router"],
  ["@sveltejs/kit", "sveltekit"],
  ["@solidjs/start", "solidstart"],
  ["@builder.io/qwik", "qwik"],
  ["gatsby", "gatsby"],
  ["gridsome", "gridsome"],
  ["nuxt", "nuxt"],
  ["next", "next"],
  ["vitepress", "vitepress"],
  ["@docusaurus/core", "docusaurus"],
  ["@11ty/eleventy", "eleventy"],
  ["@elderjs/elderjs", "elderjs"],
  ["hexo", "hexo"],
  ["ember-cli", "ember"],
  ["@angular/cli", "angular"],
  ["@vue/cli-service", "vue"],
  ["preact-cli", "preact"],
  ["react-scripts", "react"],
  ["brunch", "brunch"],
  ["vite", "vite"],
];

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

// access() handles both files and directories; Bun.file().exists() misses directories.
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectFramework(
  root: string,
): Promise<FrameworkPreset | undefined> {
  const pkg = await readJson(join(root, "package.json"));
  if (pkg) {
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    for (const [dependency, presetId] of JS_DETECTORS) {
      if (deps[dependency]) return findPreset(presetId);
    }
  }

  const gemfile = await readText(join(root, "Gemfile"));
  if (
    gemfile?.includes("jekyll") ||
    (await exists(join(root, "_config.yml")))
  ) {
    return findPreset("jekyll");
  }

  if (await exists(join(root, "mkdocs.yml"))) return findPreset("mkdocs");
  if (await exists(join(root, "pelicanconf.py"))) return findPreset("pelican");
  if (await exists(join(root, "conf.py"))) return findPreset("sphinx");

  // Zola and Hugo both use config.toml; Zola's templates/ dir disambiguates.
  if (
    (await exists(join(root, "config.toml"))) &&
    (await exists(join(root, "templates")))
  ) {
    return findPreset("zola");
  }

  if (
    (await exists(join(root, "hugo.toml"))) ||
    (await exists(join(root, "hugo.yaml"))) ||
    ((await exists(join(root, "config.toml"))) &&
      (await exists(join(root, "content"))))
  ) {
    return findPreset("hugo");
  }

  return undefined;
}

export async function detectPackageManager(
  root: string,
): Promise<PackageManager> {
  if (
    (await exists(join(root, "bun.lock"))) ||
    (await exists(join(root, "bun.lockb")))
  ) {
    return "bun";
  }
  if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}
