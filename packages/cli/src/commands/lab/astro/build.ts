/**
 * Running the project's own build.
 *
 * The command runs `astro build` through the project's package manager, so the
 * build sees the same binaries and the same lockfile the developer does. It is
 * run before any resource is created, so a build that fails cannot leave three
 * empty resources behind.
 */
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { detectWorkspace } from "../../../core/package-manager.ts";

/** The build command, per package manager. */
export async function buildCommand(root: string): Promise<string> {
  const { pm } = await detectWorkspace(root);
  return pm === "npm" ? "npm run build" : `${pm} run build`;
}

/** Run one shell command in the project, streaming its output. */
export async function run(command: string, cwd: string): Promise<void> {
  logger.info(`Running: ${command}`);
  const shell =
    process.platform === "win32"
      ? ["cmd", "/c", command]
      : ["sh", "-c", command];
  const proc = Bun.spawn(shell, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) {
    throw new UserError(
      `\`${command}\` failed.`,
      "Fix the build, then run the command again.",
    );
  }
}
