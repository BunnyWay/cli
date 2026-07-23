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
