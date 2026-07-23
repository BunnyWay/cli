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

// Toolchain setup + dependency install, without the build line.
const JS_SETUP: Record<PackageManager, string[]> = {
  bun: [
    "      - uses: oven-sh/setup-bun@v2",
    "      - run: bun install --frozen-lockfile",
  ],
  pnpm: [
    "      - uses: pnpm/action-setup@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    '          node-version: "lts/*"',
    "          cache: pnpm",
    "      - run: pnpm install --frozen-lockfile",
  ],
  yarn: [
    "      - uses: actions/setup-node@v4",
    "        with:",
    '          node-version: "lts/*"',
    "          cache: yarn",
    "      - run: yarn install --frozen-lockfile",
  ],
  npm: [
    "      - uses: actions/setup-node@v4",
    "        with:",
    '          node-version: "lts/*"',
    "          cache: npm",
    "      - run: npm ci",
  ],
};

function jsSteps(preset: FrameworkPreset, pm: PackageManager): string[] {
  const build = presetBuildCommand(preset, pm) ?? `${pm} run build`;
  return [...JS_SETUP[pm], `      - run: ${build}`];
}

function buildSteps(
  preset: FrameworkPreset,
  packageManager: PackageManager,
): string[] {
  switch (preset.toolchain) {
    case "js":
      return jsSteps(preset, packageManager);
    case "ruby":
      return [
        "      - uses: ruby/setup-ruby@v1",
        "        with:",
        '          ruby-version: "3.3"',
        "          bundler-cache: true",
        `      - run: ${preset.build}`,
        "        env:",
        "          JEKYLL_ENV: production",
      ];
    case "hugo":
      return [
        "      - uses: peaceiris/actions-hugo@v3",
        "        with:",
        '          hugo-version: "latest"',
        "          extended: true",
        `      - run: ${preset.build}`,
      ];
    case "python":
      return [
        "      - uses: actions/setup-python@v5",
        "        with:",
        '          python-version: "3.x"',
        "      - run: pip install -r requirements.txt",
        `      - run: ${preset.build}`,
      ];
    case "zola":
      return [
        "      - uses: taiki-e/install-action@v2",
        "        with:",
        "          tool: zola",
        `      - run: ${preset.build}`,
      ];
    case "dotnet":
      return [
        "      - uses: actions/setup-dotnet@v4",
        "        with:",
        '          dotnet-version: "8.0.x"',
        `      - run: ${preset.build}`,
      ];
    case "none":
      return ["      # No build step: static files deploy as-is."];
  }
}

// Render the GitHub Actions workflow: previews on PRs, production on pushes to main, via the BunnyWay/actions deploy-site action.
export function renderSitesWorkflow(opts: {
  site: string;
  preset: FrameworkPreset;
  packageManager: PackageManager;
}): string {
  const { site, preset, packageManager } = opts;
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
    "    # Fork PRs have no access to secrets; skip instead of failing.",
    "    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository",
    "    permissions:",
    "      contents: read",
    "      pull-requests: write # preview comment",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "",
    ...buildSteps(preset, packageManager),
    "",
    `      - uses: ${DEPLOY_SITE_ACTION}`,
    "        with:",
    // Quote the interpolated values so they're always inert YAML scalars.
    `          site: ${JSON.stringify(site)}`,
    `          directory: ${JSON.stringify(preset.dir)}`,
    "          production: ${{ github.event_name == 'push' }}",
    "          api_key: ${{ secrets.BUNNY_API_KEY }}",
  ];
  return `${lines.join("\n")}\n`;
}
