// biome-ignore-all lint/suspicious/noTemplateCurlyInString: emits GitHub Actions ${{ }} expressions, not JS template strings
import {
  type FrameworkPreset,
  type PackageManager,
  presetBuildCommand,
} from "./frameworks.ts";

export const SITES_WORKFLOW_PATH = ".github/workflows/bunny-sites.yml";

// Bump the tag when a new major of the action ships; the action wraps the CLI.
export const DEPLOY_SITE_ACTION =
  "BunnyWay/actions/deploy-site@deploy-site_1.0.0";

// Toolchain setup + dependency install, without the build line. setup-node looks for the lockfile at the checkout root, so a nested project passes its own path.
function jsSetup(
  pm: PackageManager,
  cacheDependencyPath: string | undefined,
): string[] {
  const cachePath = cacheDependencyPath
    ? [
        `          cache-dependency-path: ${JSON.stringify(cacheDependencyPath)}`,
      ]
    : [];
  switch (pm) {
    case "bun":
      return [
        "      - uses: oven-sh/setup-bun@v2",
        "      - run: bun install --frozen-lockfile",
      ];
    case "pnpm":
      return [
        "      - uses: pnpm/action-setup@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        '          node-version: "lts/*"',
        "          cache: pnpm",
        ...cachePath,
        "      - run: pnpm install --frozen-lockfile",
      ];
    case "yarn":
      return [
        "      - uses: actions/setup-node@v4",
        "        with:",
        '          node-version: "lts/*"',
        "          cache: yarn",
        ...cachePath,
        "      - run: yarn install --frozen-lockfile",
      ];
    case "npm":
      return [
        "      - uses: actions/setup-node@v4",
        "        with:",
        '          node-version: "lts/*"',
        "          cache: npm",
        ...cachePath,
        "      - run: npm ci",
      ];
  }
}

// A `sites.build` from bunny.jsonc is user text, so quote it when a bare YAML scalar wouldn't survive it; preset commands are plain and stay unquoted.
const YAML_UNSAFE_SCALAR = /^[-?:,[\]{}#&*!|>'"%@`]|\n|:\s|\s#/;

function runStep(command: string | undefined): string {
  const value = command ?? "";
  return `      - run: ${YAML_UNSAFE_SCALAR.test(value) ? JSON.stringify(value) : value}`;
}

function jsSteps(
  preset: FrameworkPreset,
  pm: PackageManager,
  build: string | undefined,
  cacheDependencyPath: string | undefined,
): string[] {
  const command = build ?? presetBuildCommand(preset, pm) ?? `${pm} run build`;
  return [...jsSetup(pm, cacheDependencyPath), runStep(command)];
}

function buildSteps(
  preset: FrameworkPreset,
  packageManager: PackageManager,
  build: string | undefined,
  cacheDependencyPath: string | undefined,
): string[] {
  switch (preset.toolchain) {
    case "js":
      return jsSteps(preset, packageManager, build, cacheDependencyPath);
    case "ruby":
      return [
        "      - uses: ruby/setup-ruby@v1",
        "        with:",
        '          ruby-version: "3.3"',
        "          bundler-cache: true",
        runStep(build ?? preset.build),
        "        env:",
        "          JEKYLL_ENV: production",
      ];
    case "hugo":
      return [
        "      - uses: peaceiris/actions-hugo@v3",
        "        with:",
        '          hugo-version: "latest"',
        "          extended: true",
        runStep(build ?? preset.build),
      ];
    case "python":
      return [
        "      - uses: actions/setup-python@v5",
        "        with:",
        '          python-version: "3.x"',
        "      - run: pip install -r requirements.txt",
        runStep(build ?? preset.build),
      ];
    case "zola":
      return [
        "      - uses: taiki-e/install-action@v2",
        "        with:",
        "          tool: zola",
        runStep(build ?? preset.build),
      ];
    case "dotnet":
      return [
        "      - uses: actions/setup-dotnet@v4",
        "        with:",
        '          dotnet-version: "8.0.x"',
        runStep(build ?? preset.build),
      ];
    case "none":
      // A static site has no toolchain to set up, but a configured build still runs.
      return build
        ? [runStep(build)]
        : ["      # No build step: static files deploy as-is."];
  }
}

/** Join a workflow-root-relative prefix onto a project-relative path, POSIX-style (these are YAML/GitHub paths, never local ones). */
export function workflowPath(prefix: string | undefined, path: string): string {
  if (!prefix) return path;
  return path === "." ? prefix : `${prefix.replace(/\/$/, "")}/${path}`;
}

// Render the GitHub Actions workflow: previews on PRs, production on pushes to main, via the BunnyWay/actions deploy-site action. `dir`/`build` carry `sites.dir`/`sites.build` from bunny.jsonc, and `workingDirectory` is where that config lives relative to the workflow root, so CI builds and deploys exactly what `sites deploy` does.
export function renderSitesWorkflow(opts: {
  site: string;
  preset: FrameworkPreset;
  packageManager: PackageManager;
  dir?: string;
  build?: string;
  workingDirectory?: string;
  cacheDependencyPath?: string;
}): string {
  const { site, preset, packageManager, workingDirectory } = opts;
  // Every `run` step builds from the project directory; `uses` inputs stay workflow-root-relative, so the deploy directory carries the prefix instead.
  const defaults = workingDirectory
    ? [
        "    defaults:",
        "      run:",
        `        working-directory: ${JSON.stringify(workingDirectory)}`,
      ]
    : [];
  const lines = [
    "name: Deploy site",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "",
    "# One deploy at a time per ref; a newer commit cancels the older build.",
    "concurrency:",
    "  group: bunny-sites-${{ github.ref }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  deploy:",
    "    runs-on: ubuntu-latest",
    ...defaults,
    "    # Fork PRs have no access to secrets; skip instead of failing.",
    "    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository",
    "    permissions:",
    "      contents: read",
    "      pull-requests: write # preview comment",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "",
    ...buildSteps(preset, packageManager, opts.build, opts.cacheDependencyPath),
    "",
    `      - uses: ${DEPLOY_SITE_ACTION}`,
    "        with:",
    // Quote the interpolated values so they're always inert YAML scalars.
    `          site: ${JSON.stringify(site)}`,
    `          directory: ${JSON.stringify(workflowPath(workingDirectory, opts.dir ?? preset.dir))}`,
    "          production: ${{ github.event_name == 'push' }}",
    "          api_key: ${{ secrets.BUNNY_API_KEY }}",
  ];
  return `${lines.join("\n")}\n`;
}
