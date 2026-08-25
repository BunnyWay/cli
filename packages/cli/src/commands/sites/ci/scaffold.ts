import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { UserError } from "../../../core/errors.ts";
import { runGit } from "../../../core/git.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, prompts } from "../../../core/ui.ts";
import {
  detectFramework,
  detectPackageManager,
  FRAMEWORK_PRESETS,
  type FrameworkPreset,
  findPreset,
  type PackageManager,
  readPackageJson,
} from "./frameworks.ts";
import {
  renderSitesWorkflow,
  SITES_WORKFLOW_PATH,
  workflowPath,
} from "./workflow.ts";

/** The repo root, or null when `cwd` isn't inside a git repository. */
export async function gitTopLevel(cwd: string): Promise<string | null> {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]);
}

/** The host of a git remote URL, handling both scp-style (`git@host:path`) and URL forms; null when neither parses. */
export function remoteHost(url: string): string | null {
  const scp = url.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)/);
  if (scp?.[1]) return scp[1].toLowerCase();
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function hasGitHubOrigin(root: string): Promise<boolean> {
  const url = await runGit(root, ["remote", "get-url", "origin"]);
  const host = url ? remoteHost(url) : null;
  // A substring check would accept hosts like github.com.example.invalid.
  return host === "github.com" || host?.endsWith(".github.com") === true;
}

export interface ScaffoldResult {
  /** Workflow path relative to the repo root. */
  path: string;
  preset: FrameworkPreset;
  packageManager: PackageManager;
  /** Directory the workflow deploys, relative to the repo root: `sites.dir` when configured, else the preset's, prefixed when the project sits below the root. */
  dir: string;
}

// Lockfiles that decide the package manager; a nested project may carry its own, in which case setup-node needs to be pointed at it.
const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
];

// The git top level and the bunny.jsonc directory can reach the same place by different paths (macOS /tmp -> /private/tmp), which would read as "outside the repo".
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Where the project sits relative to the workflow root, POSIX-style; "" when they're the same and undefined when the project is outside the root. */
export function projectPrefix(
  workflowRoot: string,
  projectRoot: string | undefined,
): string | undefined {
  if (!projectRoot) return "";
  const rel = relative(realOrSelf(workflowRoot), realOrSelf(projectRoot));
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

interface WorkflowSettings {
  /** Directory detection runs in and `sites.dir`/`sites.build` resolve against. */
  projectRoot: string;
  /** That directory relative to the workflow root, POSIX-style; "" when they're the same. */
  prefix: string;
  dir?: string;
  build?: string;
  cacheDependencyPath?: string;
}

// A bunny.jsonc outside the workflow root can't be expressed in a repo-rooted workflow, so its paths are dropped (with a warning) and the preset's are used from the root.
async function workflowSettings(opts: {
  root: string;
  projectRoot?: string;
  dir?: string;
  build?: string;
}): Promise<WorkflowSettings> {
  const prefix = projectPrefix(opts.root, opts.projectRoot);
  if (prefix === undefined) {
    logger.warn(
      `bunny.jsonc sits outside ${opts.root}, so its \`dir\`/\`build\` can't be used in the workflow.`,
    );
    return { projectRoot: opts.root, prefix: "" };
  }

  const projectRoot = opts.projectRoot ?? opts.root;
  // Only a lockfile of its own moves the cache lookup; a monorepo-root lockfile is what setup-node finds by default.
  const lockfile = prefix
    ? LOCKFILES.find((name) => existsSync(join(projectRoot, name)))
    : undefined;
  return {
    projectRoot,
    prefix,
    dir: opts.dir,
    build: opts.build,
    cacheDependencyPath: lockfile ? workflowPath(prefix, lockfile) : undefined,
  };
}

// A configured build on the static preset (an unrecognized bundler, say) gets the JS setup/install steps when the project has a package.json; the toolchain presets already install for themselves.
async function needsJsInstall(
  preset: FrameworkPreset,
  settings: WorkflowSettings,
): Promise<boolean> {
  if (preset.toolchain !== "none" || settings.build === undefined) return false;
  return (await readPackageJson(settings.projectRoot)) !== null;
}

/** Resolve the framework preset: explicit id, detection, prompt, static fallback. */
async function resolvePreset(
  root: string,
  frameworkId: string | undefined,
  interactive: boolean,
  dir: string | undefined,
): Promise<FrameworkPreset> {
  if (frameworkId) {
    const preset = findPreset(frameworkId);
    if (!preset) {
      throw new UserError(
        `Unknown framework "${frameworkId}".`,
        `Known frameworks: ${FRAMEWORK_PRESETS.map((p) => p.id).join(", ")}.`,
      );
    }
    return preset;
  }

  const detected = await detectFramework(root);
  if (detected) {
    logger.info(`Detected ${detected.label} (deploys ${dir ?? detected.dir}).`);
    return detected;
  }

  if (interactive) {
    const { value } = await prompts({
      type: "select",
      name: "value",
      message: "Framework:",
      choices: FRAMEWORK_PRESETS.map((p) => ({ title: p.label, value: p.id })),
      initial: FRAMEWORK_PRESETS.length - 1,
    });
    const preset = value ? findPreset(value) : undefined;
    if (preset) return preset;
  }

  const fallback = findPreset("static");
  if (!fallback) throw new UserError("Missing static framework preset.");
  return fallback;
}

// Write `.github/workflows/bunny-sites.yml`; returns null when the user declines to overwrite an existing file, throws when non-interactive and it exists without `force`. `sites.dir`/`sites.build` from bunny.jsonc win over the preset, so CI deploys what `sites deploy` does; `projectRoot` (the bunny.jsonc directory) is where those paths resolve, and the workflow gets a working directory when it sits below `root`.
export async function scaffoldSitesWorkflow(opts: {
  site: string;
  root: string;
  projectRoot?: string;
  frameworkId?: string;
  interactive: boolean;
  force?: boolean;
  dir?: string;
  build?: string;
}): Promise<ScaffoldResult | null> {
  const settings = await workflowSettings(opts);
  const preset = await resolvePreset(
    settings.projectRoot,
    opts.frameworkId,
    opts.interactive,
    settings.dir,
  );
  const packageManager = await detectPackageManager(settings.projectRoot);
  const content = renderSitesWorkflow({
    site: opts.site,
    preset,
    packageManager,
    dir: settings.dir,
    build: settings.build,
    workingDirectory: settings.prefix || undefined,
    cacheDependencyPath: settings.cacheDependencyPath,
    installDeps: await needsJsInstall(preset, settings),
  });

  const target = join(opts.root, SITES_WORKFLOW_PATH);
  if (existsSync(target) && !opts.force) {
    if (!opts.interactive) {
      throw new UserError(
        `${SITES_WORKFLOW_PATH} already exists.`,
        "Pass --force to overwrite it.",
      );
    }
    if (
      !(await confirm(`Overwrite ${SITES_WORKFLOW_PATH}?`, {
        initial: false,
        optional: true,
      }))
    ) {
      return null;
    }
  }

  mkdirSync(dirname(target), { recursive: true });
  await Bun.write(target, content);
  return {
    path: SITES_WORKFLOW_PATH,
    preset,
    packageManager,
    dir: workflowPath(settings.prefix, settings.dir ?? preset.dir),
  };
}

/** Print the workflow and setup steps for users who declined the scaffold. */
export async function printWorkflowInstructions(
  site: string,
  root: string,
  config?: { root?: string; dir?: string; build?: string },
): Promise<void> {
  const settings = await workflowSettings({
    root,
    projectRoot: config?.root,
    dir: config?.dir,
    build: config?.build,
  });
  const preset =
    (await detectFramework(settings.projectRoot)) ?? findPreset("static");
  if (!preset) return;
  const packageManager = await detectPackageManager(settings.projectRoot);
  logger.log();
  logger.log(`To deploy from GitHub later, add ${SITES_WORKFLOW_PATH}:`);
  logger.log();
  logger.log(
    renderSitesWorkflow({
      site,
      preset,
      packageManager,
      dir: settings.dir,
      build: settings.build,
      workingDirectory: settings.prefix || undefined,
      cacheDependencyPath: settings.cacheDependencyPath,
      installDeps: await needsJsInstall(preset, settings),
    }),
  );
  printSecretHint();
}

export function printSecretHint(): void {
  logger.log("Then add your API key as a repository secret:");
  logger.accent("  gh secret set BUNNYNET_API_KEY");
  logger.dim("  (or GitHub repo Settings -> Secrets and variables -> Actions)");
}

// Offer to add the BUNNYNET_API_KEY repo secret via the `gh` CLI (prompted); falls back to printing the manual steps when declined or unavailable.
export async function offerGitHubSecret(opts: {
  apiKey: string | undefined;
  root: string;
  interactive: boolean;
}): Promise<void> {
  const gh = Bun.which("gh");
  if (opts.interactive && gh && opts.apiKey) {
    const proceed = await confirm(
      "Add the BUNNYNET_API_KEY secret to this GitHub repo now (runs `gh secret set`)?",
      { initial: true, optional: true },
    );
    if (proceed) {
      // The key goes via stdin, never argv: process arguments are visible in `ps`.
      const proc = Bun.spawn([gh, "secret", "set", "BUNNYNET_API_KEY"], {
        cwd: opts.root,
        stdout: "ignore",
        stderr: "pipe",
        stdin: new Blob([opts.apiKey]),
      });
      const [code, err] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      if (code === 0) {
        logger.success("Added the BUNNYNET_API_KEY secret.");
        return;
      }
      logger.warn(
        `Couldn't set the secret: ${err.trim() || `gh exited with ${code}`}`,
      );
    }
  }
  printSecretHint();
}
