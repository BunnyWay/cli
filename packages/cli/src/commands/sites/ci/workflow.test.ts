// biome-ignore-all lint/suspicious/noTemplateCurlyInString: asserts on GitHub Actions ${{ }} expressions in the generated workflow
import { expect, test } from "bun:test";
import { findPreset } from "./frameworks.ts";
import { DEPLOY_SITE_ACTION, renderSitesWorkflow } from "./workflow.ts";

function preset(id: string) {
  const p = findPreset(id);
  if (!p) throw new Error(`missing preset ${id}`);
  return p;
}

test("astro + bun workflow builds with bun and deploys dist", () => {
  const yml = renderSitesWorkflow({
    site: "my-site",
    preset: preset("astro"),
    packageManager: "bun",
  });
  expect(yml).toContain("uses: oven-sh/setup-bun@v2");
  expect(yml).toContain("run: bun run build");
  expect(yml).toContain(`uses: ${DEPLOY_SITE_ACTION}`);
  expect(yml).toContain('site: "my-site"');
  expect(yml).toContain('directory: "dist"');
  expect(yml).toContain("api_key: ${{ secrets.BUNNYNET_API_KEY }}");
  expect(yml).not.toContain("working-directory");
  expect(yml).not.toContain("cache-dependency-path");
});

// Deploying is publishing: only pushes to main and dispatch go live, and a cancelled run could strand a half-written deploy directory.
test("the workflow deploys on push/dispatch only, with deployments: write, serialized and never cancelled", () => {
  const yml = renderSitesWorkflow({
    site: "my-site",
    preset: preset("astro"),
    packageManager: "bun",
  });
  expect(yml).toContain("  push:\n    branches: [main]");
  expect(yml).toContain("workflow_dispatch:");
  expect(yml).not.toContain("pull_request");
  expect(yml).toContain("contents: read");
  expect(yml).toContain("deployments: write");
  expect(yml).toContain("group: bunny-sites");
  expect(yml).toContain("cancel-in-progress: false");
});

test("static workflow has no build step", () => {
  const yml = renderSitesWorkflow({
    site: "plain",
    preset: preset("static"),
    packageManager: "npm",
  });
  expect(yml).not.toContain("run: npm");
  expect(yml).toContain('directory: "."');
});

test("nuxt runs its build override via the package manager's exec runner", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("nuxt"),
    packageManager: "bun",
  });
  expect(yml).toContain("run: bun install --frozen-lockfile");
  expect(yml).toContain("run: bunx nuxi generate");
  expect(yml).toContain('directory: ".output/public"');
  expect(yml).not.toContain("run: bun run build");
});

test("mkdocs uses the python toolchain and deploys site", () => {
  const yml = renderSitesWorkflow({
    site: "docs",
    preset: preset("mkdocs"),
    packageManager: "npm",
  });
  expect(yml).toContain("uses: actions/setup-python@v7");
  expect(yml).toContain("run: pip install -r requirements.txt");
  expect(yml).toContain("run: mkdocs build");
  expect(yml).toContain('directory: "site"');
  expect(yml).not.toContain("setup-node");
});

test("sites.dir and sites.build from bunny.jsonc win over the preset", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("astro"),
    packageManager: "npm",
    dir: "build",
    build: "make site",
  });
  expect(yml).toContain("run: npm ci");
  expect(yml).toContain('run: "make site"');
  expect(yml).not.toContain("run: npm run build");
  expect(yml).toContain('directory: "build"');
});

// bunny.jsonc can live below the repo root; the workflow runs from the checkout root, so run steps get a working directory and the action's directory carries the prefix.
test("a nested project builds from its own directory and deploys the prefixed path", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("astro"),
    packageManager: "npm",
    dir: "dist",
    build: "npm run build:site",
    workingDirectory: "packages/site",
    cacheDependencyPath: "packages/site/package-lock.json",
  });
  expect(yml).toContain('        working-directory: "packages/site"');
  expect(yml).toContain('run: "npm run build:site"');
  expect(yml).toContain(
    '          cache-dependency-path: "packages/site/package-lock.json"',
  );
  expect(yml).toContain('directory: "packages/site/dist"');
});

test("a configured build runs even for a static preset", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("static"),
    packageManager: "npm",
    build: "./build.sh",
  });
  expect(yml).toContain('run: "./build.sh"');
  expect(yml).not.toContain("# No build step");
  // No package.json, so nothing to install.
  expect(yml).not.toContain("setup-node");
});

// An unrecognized bundler lands on the static preset, but a configured `npm run build` still needs dependencies on the runner.
test("a configured build gets the JS install steps when installDeps is set", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("static"),
    packageManager: "pnpm",
    build: "pnpm run build",
    dir: "out",
    installDeps: true,
  });
  expect(yml).toContain("uses: pnpm/action-setup@v6");
  expect(yml).toContain("run: pnpm install --frozen-lockfile");
  expect(yml).toContain('run: "pnpm run build"');
  expect(yml).toContain('directory: "out"');
});

// A configured build is always a quoted scalar: bare `true`/`null`/`1.5` would parse as a boolean/null/number, which Actions rejects, and a newline would open a new YAML line.
test("a configured build is always emitted as a quoted scalar", () => {
  const injected = renderSitesWorkflow({
    site: "s",
    preset: preset("static"),
    packageManager: "npm",
    build: "echo hi\n      run: rm -rf /",
  });
  expect(injected).toContain('run: "echo hi\\n      run: rm -rf /"');
  expect(injected).not.toContain("\n      run: rm -rf /\n");

  for (const build of ["true", "false", "null", "1.5"]) {
    const yml = renderSitesWorkflow({
      site: "s",
      preset: preset("static"),
      packageManager: "npm",
      build,
    });
    expect(yml).toContain(`run: "${build}"`);
  }
});

test("interpolated site name is a quoted, inert YAML scalar", () => {
  const yml = renderSitesWorkflow({
    site: "evil\n      run: rm -rf /",
    preset: preset("static"),
    packageManager: "npm",
  });
  // The newline is encoded inside the quoted scalar, never a new YAML line.
  expect(yml).toContain('site: "evil\\n      run: rm -rf /"');
  expect(yml).not.toContain("\n      run: rm -rf /\n");
});

test("npm and pnpm projects get the matching install steps", () => {
  const npm = renderSitesWorkflow({
    site: "s",
    preset: preset("vite"),
    packageManager: "npm",
  });
  expect(npm).toContain("run: npm ci");
  expect(npm).toContain("cache: npm");

  const pnpm = renderSitesWorkflow({
    site: "s",
    preset: preset("vite"),
    packageManager: "pnpm",
  });
  expect(pnpm).toContain("uses: pnpm/action-setup@v6");
  expect(pnpm).toContain("run: pnpm install --frozen-lockfile");
});
