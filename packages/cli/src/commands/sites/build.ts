import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import {
  detectFramework,
  detectPackageManager,
  presetBuildCommand,
  readPackageJson,
} from "./ci/frameworks.ts";

export interface AutoBuild {
  /** Shell command to run. */
  command: string;
  /** Human label for the prompt: the framework name, or a generic hint. */
  label: string;
  /** Build output dir relative to the repo root, when the framework fixes one. */
  dir?: string;
}

// Infer a build to offer before a deploy: the detected framework's command, else a package.json `build` script; null when nothing is detected or the framework is static.
export async function resolveAutoBuild(
  root: string,
): Promise<AutoBuild | null> {
  const preset = await detectFramework(root);
  const pm = await detectPackageManager(root);
  if (preset) {
    const command = presetBuildCommand(preset, pm);
    return command ? { command, label: preset.label, dir: preset.dir } : null;
  }
  const pkg = await readPackageJson(root);
  const scripts = pkg?.scripts as Record<string, string> | undefined;
  if (scripts?.build) {
    return { command: `${pm} run build`, label: "a package.json build script" };
  }
  return null;
}

export interface RequestedBuild {
  command: string;
  /** Framework label when the command came from detection, for the log line. */
  label?: string;
  /** Build output dir relative to the repo root, when the framework fixes one. */
  dir?: string;
}

export async function resolveRequestedBuild(
  flag: string,
  configured: string | undefined,
  root: string,
): Promise<RequestedBuild> {
  const explicit = flag || configured;
  if (explicit) {
    return { command: explicit, dir: (await detectFramework(root))?.dir };
  }
  const auto = await resolveAutoBuild(root);
  if (!auto) {
    throw new UserError(
      "No build command configured and none detected.",
      'Pass one (`--build "npm run build"`) or set `sites.build` in bunny.jsonc.',
    );
  }
  return auto;
}

export async function runBuildCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<void> {
  logger.info(`Running build: ${command}`);
  const shell =
    process.platform === "win32"
      ? ["cmd", "/c", command]
      : ["sh", "-c", command];
  const proc = Bun.spawn(shell, {
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new UserError(
      `Build command failed with exit code ${code}.`,
      "Fix the build and re-run `bunny sites deploy --build`.",
    );
  }
}
