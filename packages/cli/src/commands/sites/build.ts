import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertEnvName(name: string): void {
  if (!ENV_NAME_RE.test(name)) {
    throw new UserError(
      `"${name}" is not a valid environment variable name.`,
      "Names must start with a letter or underscore and contain only letters, digits, and underscores.",
    );
  }
}

/** Parse repeated `--env KEY=VALUE` flags. */
export function parseEnvAssignments(
  entries: string[] | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new UserError(
        `Invalid --env value "${entry}".`,
        "Use --env KEY=VALUE.",
      );
    }
    const name = entry.slice(0, eq);
    assertEnvName(name);
    env[name] = entry.slice(eq + 1);
  }
  return env;
}

/** Parse a dotenv-style file: KEY=VALUE lines, `#` comments, optional quotes. */
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    if (!ENV_NAME_RE.test(name)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[name] = value;
  }
  return env;
}

/**
 * Run the build command in a shell with the merged environment, streaming
 * its output. Throws on a non-zero exit so a broken build never deploys.
 */
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
