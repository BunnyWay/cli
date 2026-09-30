import {
  type FrameworkPreset,
  findPreset,
  type PackageManager,
} from "./presets.ts";

/**
 * What detection reads from a project root, so it runs anywhere: on disk (the CLI), against a
 * GitHub repository (the dashboard, the Sites control plane), or in a test.
 */
export interface ProjectSnapshot {
  /** Names of the files and directories at the project root. */
  entries: readonly string[];
  /** The parsed package.json, or null when there is none. */
  packageJson?: Record<string, unknown> | null;
  /** The Gemfile's text, or null when there is none. */
  gemfile?: string | null;
  /** Each root `.csproj` and its text; Blazor WebAssembly is detected from these. */
  csprojs?: readonly { name: string; text: string }[];
}

/** The only files whose contents detection reads; everything else is a presence check on `entries`. */
export const DETECTION_CONTENT_FILES = [
  "package.json",
  "Gemfile",
  "*.csproj",
] as const;

// Ordered most-specific first (meta-frameworks depend on vite, so vite goes last).
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

// Standalone Blazor WebAssembly only: server-hosted Blazor apps use a different SDK and aren't static.
function detectBlazorFrom(
  csprojs: readonly { name: string; text: string }[],
): FrameworkPreset | undefined {
  const preset = findPreset("blazor");
  if (!preset) return undefined;
  for (const { name, text: csproj } of csprojs) {
    if (!csproj.includes("Microsoft.NET.Sdk.BlazorWebAssembly")) continue;
    // Multi-target projects must name one framework to publish, so pick the newest.
    const plural = csproj.match(/<TargetFrameworks>([^<]+)</)?.[1];
    const tfms = (
      plural ??
      csproj.match(/<TargetFramework>([^<]+)</)?.[1] ??
      ""
    )
      .split(";")
      .map((t) => t.trim())
      .map((tfm) => ({ tfm, v: tfm.match(/^net(\d+)\.(\d+)(-[\w.]+)?$/) }))
      .filter((t) => t.v)
      .sort(
        (a, b) =>
          Number(b.v?.[1]) - Number(a.v?.[1]) ||
          Number(b.v?.[2]) - Number(a.v?.[2]),
      );
    const newest = tfms[0];
    const framework = plural && newest ? ` -f ${newest.tfm}` : "";
    // These values reach a shell, so a filename outside a safe charset is left for dotnet to find.
    const project = /^[\w.-]+$/.test(name) ? ` ${name}` : "";
    return {
      ...preset,
      build: `dotnet publish${project} -c Release${framework} -o bin/publish`,
      ...(newest?.v && { dotnetVersion: `${newest.v[1]}.${newest.v[2]}.x` }),
    };
  }
  return undefined;
}

export function detectFrameworkFrom(
  project: ProjectSnapshot,
): FrameworkPreset | undefined {
  const has = (name: string) => project.entries.includes(name);
  const pkg = project.packageJson;
  if (pkg) {
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    for (const [dependency, presetId] of JS_DETECTORS) {
      if (deps[dependency]) return findPreset(presetId);
    }
  }

  const blazor = detectBlazorFrom(project.csprojs ?? []);
  if (blazor) return blazor;

  if (project.gemfile?.includes("jekyll") || has("_config.yml")) {
    return findPreset("jekyll");
  }

  if (has("mkdocs.yml")) return findPreset("mkdocs");
  if (has("pelicanconf.py")) return findPreset("pelican");
  if (has("conf.py")) return findPreset("sphinx");

  // Zola and Hugo both use config.toml; Zola's templates/ dir disambiguates.
  if (has("config.toml") && has("templates")) return findPreset("zola");

  if (
    has("hugo.toml") ||
    has("hugo.yaml") ||
    (has("config.toml") && has("content"))
  ) {
    return findPreset("hugo");
  }

  return undefined;
}

export function detectPackageManagerFrom(
  entries: readonly string[],
): PackageManager {
  if (entries.includes("bun.lock") || entries.includes("bun.lockb"))
    return "bun";
  if (entries.includes("pnpm-lock.yaml")) return "pnpm";
  if (entries.includes("yarn.lock")) return "yarn";
  return "npm";
}
