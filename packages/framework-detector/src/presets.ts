// Framework presets for bunny sites: what each framework builds with and where it writes its output.

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
  /** Serves index.html for client-side routes unless `sites.spa` overrides. */
  spa?: boolean;
  /** SDK channel for the dotnet toolchain's setup step, e.g. `9.0.x`. */
  dotnetVersion?: string;
}

// Static must stay last: the interactive prompt defaults to it.
export const FRAMEWORK_PRESETS: FrameworkPreset[] = [
  {
    id: "analog",
    label: "Analog",
    dir: "dist/analog/public",
    toolchain: "js",
  },
  // Angular's application builder emits dist/<project>/browser; adjust if yours differs.
  { id: "angular", label: "Angular", dir: "dist", toolchain: "js", spa: true },
  {
    id: "astro",
    label: "Astro",
    dir: "dist",
    toolchain: "js",
  },
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
  { id: "ember", label: "Ember", dir: "dist", toolchain: "js", spa: true },
  {
    id: "gatsby",
    label: "Gatsby",
    dir: "public",
    toolchain: "js",
  },
  {
    id: "gridsome",
    label: "Gridsome",
    dir: "dist",
    toolchain: "js",
  },
  {
    id: "hexo",
    label: "Hexo",
    dir: "public",
    toolchain: "js",
    build: "hexo generate",
  },
  {
    id: "next",
    label: "Next.js (static export)",
    dir: "out",
    toolchain: "js",
  },
  {
    id: "nuxt",
    label: "Nuxt (static generate)",
    dir: ".output/public",
    toolchain: "js",
    build: "nuxt generate",
  },
  {
    id: "preact",
    label: "Preact (preact-cli)",
    dir: "build",
    toolchain: "js",
    spa: true,
  },
  {
    id: "qwik",
    label: "Qwik (static adapter)",
    dir: "dist",
    toolchain: "js",
  },
  {
    id: "react",
    label: "React (Create React App)",
    dir: "build",
    toolchain: "js",
    spa: true,
  },
  {
    id: "react-router",
    label: "React Router",
    dir: "build/client",
    toolchain: "js",
    spa: true,
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
  {
    id: "vite",
    label: "Vite",
    dir: "dist",
    toolchain: "js",
    spa: true,
  },
  {
    id: "vitepress",
    label: "VitePress",
    dir: ".vitepress/dist",
    toolchain: "js",
  },
  {
    id: "vue",
    label: "Vue (Vue CLI)",
    dir: "dist",
    toolchain: "js",
    spa: true,
  },
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
  // bin/ keeps the output gitignored; the LTS SDK builds older targets, and detection pins the project's own.
  {
    id: "blazor",
    label: "Blazor WebAssembly",
    dir: "bin/publish/wwwroot",
    toolchain: "dotnet",
    build: "dotnet publish -c Release -o bin/publish",
    spa: true,
    dotnetVersion: "10.0.x",
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

// Runner for a project-local binary; shared by the local build and the emitted CI workflow. Never falls back to a registry download or a shared cache.
export const PM_EXEC: Record<PackageManager, string> = {
  bun: "bun run",
  pnpm: "pnpm exec",
  yarn: "yarn",
  npm: "npx --no-install",
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
