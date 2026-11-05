// biome-ignore-all lint/suspicious/noTemplateCurlyInString: emits GitHub Actions ${{ }} expressions, not JS template strings
import {
  type FrameworkPreset,
  type PackageManager,
  presetBuildCommand,
} from "./presets.ts";

export const SITES_WORKFLOW_PATH = ".github/workflows/bunny-sites.yml";

// Bump the tag when a new major of the action ships; the action wraps the CLI.
export const DEPLOY_SITE_ACTION =
  "BunnyWay/actions/deploy-site@deploy-site_0.1.1";

interface JsInstall {
  /** Lockfile path for setup-node's cache when it isn't at the checkout root. */
  cacheDependencyPath?: string;
  /** False when the project has no lockfile: no dependency cache, and a plain install instead of a frozen one. */
  lockfile?: boolean;
  /** pnpm version for pnpm/action-setup, needed when the root package.json has no `packageManager` field. */
  pnpmVersion?: string;
}

// Toolchain setup + dependency install, without the build line. setup-node looks for the lockfile at the checkout root, so a nested project passes its own path.
function jsSetup(pm: PackageManager, install: JsInstall): string[] {
  const { cacheDependencyPath } = install;
  const frozen = install.lockfile !== false;
  const cachePath = cacheDependencyPath
    ? [
        `          cache-dependency-path: ${JSON.stringify(cacheDependencyPath)}`,
      ]
    : [];
  const cache = (name: string) =>
    frozen ? [`          cache: ${name}`, ...cachePath] : [];
  switch (pm) {
    case "bun":
      return [
        "      - uses: oven-sh/setup-bun@v2",
        `      - run: bun install${frozen ? " --frozen-lockfile" : ""}`,
      ];
    case "pnpm":
      return [
        "      - uses: pnpm/action-setup@v6",
        ...(install.pnpmVersion
          ? [
              "        with:",
              `          version: ${JSON.stringify(install.pnpmVersion)}`,
            ]
          : []),
        "      - uses: actions/setup-node@v7",
        "        with:",
        '          node-version: "lts/*"',
        ...cache("pnpm"),
        `      - run: pnpm install${frozen ? " --frozen-lockfile" : ""}`,
      ];
    case "yarn":
      return [
        "      - uses: actions/setup-node@v7",
        "        with:",
        '          node-version: "lts/*"',
        ...cache("yarn"),
        `      - run: yarn install${frozen ? " --frozen-lockfile" : ""}`,
      ];
    case "npm":
      return [
        "      - uses: actions/setup-node@v7",
        "        with:",
        '          node-version: "lts/*"',
        ...cache("npm"),
        `      - run: ${frozen ? "npm ci" : "npm install"}`,
      ];
  }
}

// A `sites.build` from bunny.jsonc is user text, so it's always a quoted scalar: bare `true`/`null`/`1.5` would parse as a boolean/null/number and Actions rejects a `run` that isn't a string. Preset commands come from our own table and stay readable.
function runStep(configured: string | undefined, preset?: string): string {
  const value = configured !== undefined ? JSON.stringify(configured) : preset;
  return `      - run: ${value ?? ""}`;
}

function jsSteps(
  preset: FrameworkPreset,
  pm: PackageManager,
  build: string | undefined,
  install: JsInstall,
): string[] {
  return [
    ...jsSetup(pm, install),
    runStep(build, presetBuildCommand(preset, pm) ?? `${pm} run build`),
  ];
}

function buildSteps(
  preset: FrameworkPreset,
  packageManager: PackageManager,
  build: string | undefined,
  install: JsInstall,
  installDeps: boolean | undefined,
): string[] {
  switch (preset.toolchain) {
    case "js":
      return jsSteps(preset, packageManager, build, install);
    case "ruby":
      return [
        "      - uses: ruby/setup-ruby@v1",
        "        with:",
        '          ruby-version: "3.3"',
        "          bundler-cache: true",
        runStep(build, preset.build),
        "        env:",
        "          JEKYLL_ENV: production",
      ];
    case "hugo":
      return [
        "      - uses: peaceiris/actions-hugo@v3",
        "        with:",
        '          hugo-version: "latest"',
        "          extended: true",
        runStep(build, preset.build),
      ];
    case "python":
      return [
        "      - uses: actions/setup-python@v7",
        "        with:",
        '          python-version: "3.x"',
        // A project without requirements.txt still needs the generator itself.
        `      - run: ${JSON.stringify(`if [ -f requirements.txt ]; then pip install -r requirements.txt; else pip install '${preset.pipPackage ?? preset.id}'; fi`)}`,
        runStep(build, preset.build),
      ];
    case "zola":
      return [
        "      - uses: taiki-e/install-action@v2",
        "        with:",
        "          tool: zola",
        runStep(build, preset.build),
      ];
    case "dotnet":
      return [
        "      - uses: actions/setup-dotnet@v6",
        "        with:",
        `          dotnet-version: "${preset.dotnetVersion ?? "10.0.x"}"`,
        runStep(build, preset.build),
      ];
    case "none":
      if (!build) return ["      # No build step: static files deploy as-is."];
      // An unrecognized bundler lands on the static preset; a configured build in a JS project still needs its dependencies on the runner.
      return installDeps
        ? [...jsSetup(packageManager, install), runStep(build)]
        : [runStep(build)];
  }
}

/** Join a workflow-root-relative prefix onto a project-relative path, POSIX-style (these are YAML/GitHub paths, never local ones). */
export function workflowPath(prefix: string | undefined, path: string): string {
  if (!prefix) return path;
  return path === "." ? prefix : `${prefix.replace(/\/$/, "")}/${path}`;
}

// Render the GitHub Actions workflow via the BunnyWay/actions deploy-site action: pushes to `branch` (main by default) go live, and `workflow_dispatch` redeploys on demand. `dir`/`build` carry `sites.dir`/`sites.build` from bunny.jsonc, `workingDirectory` is where that config lives relative to the workflow root, and `installDeps` adds the JS setup/install steps to a configured build the preset wouldn't have installed for, so CI builds and deploys exactly what `sites deploy` does.
export function renderSitesWorkflow(opts: {
  site: string;
  preset: FrameworkPreset;
  packageManager: PackageManager;
  dir?: string;
  build?: string;
  workingDirectory?: string;
  cacheDependencyPath?: string;
  installDeps?: boolean;
  /** The branch that goes live on push; main unless the repository's default branch differs. */
  branch?: string;
  /** The `@bunny.net/cli` version range the action runs; the action's own default when omitted. */
  cliVersion?: string;
  /** False when the project has no lockfile; see JsInstall. */
  lockfile?: boolean;
  /** pnpm version to install when the root package.json doesn't pin one. */
  pnpmVersion?: string;
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
    // Quoted: a ref may contain YAML flow syntax (`release,prod` would otherwise be two branches).
    `    branches: [${opts.branch ? JSON.stringify(opts.branch) : "main"}]`,
    "  workflow_dispatch:",
    "",
    "# Production deploys serialize across every ref; cancelling mid-upload would leave a half-written deploy directory behind.",
    "concurrency:",
    "  group: bunny-sites",
    "  cancel-in-progress: false",
    "",
    "jobs:",
    "  deploy:",
    "    runs-on: ubuntu-latest",
    ...defaults,
    "    permissions:",
    "      contents: read",
    "      deployments: write # records the deploy in the repo's Environments",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "",
    ...buildSteps(
      preset,
      packageManager,
      opts.build,
      {
        cacheDependencyPath: opts.cacheDependencyPath,
        lockfile: opts.lockfile,
        pnpmVersion: opts.pnpmVersion,
      },
      opts.installDeps,
    ),
    "",
    `      - uses: ${DEPLOY_SITE_ACTION}`,
    "        with:",
    // Quote the interpolated values so they're always inert YAML scalars.
    `          site: ${JSON.stringify(site)}`,
    `          directory: ${JSON.stringify(workflowPath(workingDirectory, opts.dir ?? preset.dir))}`,
    "          api_key: ${{ secrets.BUNNYNET_API_KEY }}",
    ...(opts.cliVersion
      ? [`          cli_version: ${JSON.stringify(opts.cliVersion)}`]
      : []),
  ];
  return `${lines.join("\n")}\n`;
}
