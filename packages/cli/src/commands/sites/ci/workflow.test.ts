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
  // Preview by default; production only on pushes to main.
  expect(yml).toContain("production: ${{ github.event_name == 'push' }}");
  // Fork PRs are skipped, not failed.
  expect(yml).toContain(
    "github.event.pull_request.head.repo.full_name == github.repository",
  );
});

// Every deploy gets its own preview zone, so PR previews need no custom domain; the workflow always runs on PRs.
test("the workflow always previews PRs and publishes pushes to main", () => {
  const yml = renderSitesWorkflow({
    site: "my-site",
    preset: preset("astro"),
    packageManager: "bun",
  });
  expect(yml).toContain("pull_request:");
  expect(yml).toContain("pull-requests: write");
  expect(yml).not.toContain("production: true");
});

test("jekyll workflow uses ruby and deploys _site", () => {
  const yml = renderSitesWorkflow({
    site: "blog",
    preset: preset("jekyll"),
    packageManager: "npm",
  });
  expect(yml).toContain("uses: ruby/setup-ruby@v1");
  expect(yml).toContain("run: bundle exec jekyll build");
  expect(yml).toContain('directory: "_site"');
  expect(yml).not.toContain("setup-node");
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
  expect(yml).toContain("uses: actions/setup-python@v5");
  expect(yml).toContain("run: pip install -r requirements.txt");
  expect(yml).toContain("run: mkdocs build");
  expect(yml).toContain('directory: "site"');
  expect(yml).not.toContain("setup-node");
});

test("zola installs the zola binary and blazor uses dotnet", () => {
  const zola = renderSitesWorkflow({
    site: "z",
    preset: preset("zola"),
    packageManager: "npm",
  });
  expect(zola).toContain("tool: zola");
  expect(zola).toContain("run: zola build");

  const blazor = renderSitesWorkflow({
    site: "b",
    preset: preset("blazor"),
    packageManager: "npm",
  });
  expect(blazor).toContain("uses: actions/setup-dotnet@v4");
  expect(blazor).toContain("run: dotnet publish -c Release");
  expect(blazor).toContain('directory: "bin/Release/net8.0/publish/wwwroot"');
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

test("a static site at the project root deploys the project directory itself", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("static"),
    packageManager: "npm",
    workingDirectory: "sites/marketing",
  });
  expect(yml).toContain('directory: "sites/marketing"');
});

test("a root-level project gets no working directory or cache path", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("astro"),
    packageManager: "npm",
  });
  expect(yml).not.toContain("working-directory");
  expect(yml).not.toContain("cache-dependency-path");
  expect(yml).toContain('directory: "dist"');
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
  expect(yml).toContain("uses: pnpm/action-setup@v4");
  expect(yml).toContain("run: pnpm install --frozen-lockfile");
  expect(yml).toContain('run: "pnpm run build"');
  expect(yml).toContain('directory: "out"');
});

test("a static site with no configured build never installs", () => {
  const yml = renderSitesWorkflow({
    site: "s",
    preset: preset("static"),
    packageManager: "npm",
    installDeps: true,
  });
  expect(yml).toContain("# No build step: static files deploy as-is.");
  expect(yml).not.toContain("setup-node");
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
  expect(pnpm).toContain("uses: pnpm/action-setup@v4");
  expect(pnpm).toContain("run: pnpm install --frozen-lockfile");
});
