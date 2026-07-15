import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import prompts from "prompts";
import { UserError } from "../../../core/errors.ts";
import { runGit } from "../../../core/git.ts";
import { logger } from "../../../core/logger.ts";
import { confirm } from "../../../core/ui.ts";
import {
  detectFramework,
  detectPackageManager,
  FRAMEWORK_PRESETS,
  type FrameworkPreset,
  findPreset,
  type PackageManager,
} from "./frameworks.ts";
import { renderSitesWorkflow, SITES_WORKFLOW_PATH } from "./workflow.ts";

/** The repo root, or null when `cwd` isn't inside a git repository. */
export async function gitTopLevel(cwd: string): Promise<string | null> {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function hasGitHubOrigin(root: string): Promise<boolean> {
  const url = await runGit(root, ["remote", "get-url", "origin"]);
  return url?.includes("github.com") ?? false;
}

export interface ScaffoldResult {
  /** Workflow path relative to the repo root. */
  path: string;
  preset: FrameworkPreset;
  packageManager: PackageManager;
}

/** Resolve the framework preset: explicit id, detection, prompt, static fallback. */
async function resolvePreset(
  root: string,
  frameworkId: string | undefined,
  interactive: boolean,
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
    logger.info(`Detected ${detected.label} (deploys ${detected.dir}).`);
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

// Write `.github/workflows/bunny-sites.yml`; returns null when the user declines to overwrite an existing file, throws when non-interactive and it exists without `force`.
export async function scaffoldSitesWorkflow(opts: {
  site: string;
  root: string;
  frameworkId?: string;
  interactive: boolean;
  force?: boolean;
}): Promise<ScaffoldResult | null> {
  const preset = await resolvePreset(
    opts.root,
    opts.frameworkId,
    opts.interactive,
  );
  const packageManager = await detectPackageManager(opts.root);
  const content = renderSitesWorkflow({
    site: opts.site,
    preset,
    packageManager,
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
      !(await confirm(`Overwrite ${SITES_WORKFLOW_PATH}?`, { initial: false }))
    ) {
      return null;
    }
  }

  mkdirSync(dirname(target), { recursive: true });
  await Bun.write(target, content);
  return { path: SITES_WORKFLOW_PATH, preset, packageManager };
}

/** Print the workflow and setup steps for users who declined the scaffold. */
export async function printWorkflowInstructions(
  site: string,
  root: string,
): Promise<void> {
  const preset = (await detectFramework(root)) ?? findPreset("static");
  if (!preset) return;
  const packageManager = await detectPackageManager(root);
  logger.log();
  logger.log(`To deploy from GitHub later, add ${SITES_WORKFLOW_PATH}:`);
  logger.log();
  logger.log(renderSitesWorkflow({ site, preset, packageManager }));
  printSecretHint();
}

export function printSecretHint(): void {
  logger.log("Then add your API key as a repository secret:");
  logger.accent("  gh secret set BUNNY_API_KEY");
  logger.dim("  (or GitHub repo Settings -> Secrets and variables -> Actions)");
}

// Offer to add the BUNNY_API_KEY repo secret via the `gh` CLI (prompted); falls back to printing the manual steps when declined or unavailable.
export async function offerGitHubSecret(opts: {
  apiKey: string | undefined;
  root: string;
  interactive: boolean;
}): Promise<void> {
  const gh = Bun.which("gh");
  if (opts.interactive && gh && opts.apiKey) {
    const proceed = await confirm(
      "Add the BUNNY_API_KEY secret to this GitHub repo now (runs `gh secret set`)?",
      { initial: true },
    );
    if (proceed) {
      const proc = Bun.spawn(
        [gh, "secret", "set", "BUNNY_API_KEY", "--body", opts.apiKey],
        {
          cwd: opts.root,
          stdout: "ignore",
          stderr: "pipe",
          stdin: "ignore",
        },
      );
      const [code, err] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      if (code === 0) {
        logger.success("Added the BUNNY_API_KEY secret.");
        return;
      }
      logger.warn(
        `Couldn't set the secret: ${err.trim() || `gh exited with ${code}`}`,
      );
    }
  }
  printSecretHint();
}
