import { join } from "node:path";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import {
  detectFramework,
  detectPackageManager,
  presetBuildCommand,
} from "./ci/frameworks.ts";

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

/**
 * Turn a dotenv value token into its string. Double-quoted values read to the
 * closing quote, unescaping `\"`/`\\` (a `#` inside stays literal); single
 * quotes are taken verbatim; unquoted values drop a whitespace-delimited inline
 * `# comment`.
 */
function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    let out = "";
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\" && i + 1 < value.length) {
        out += value[++i];
      } else if (ch === '"') {
        return out;
      } else {
        out += ch;
      }
    }
    return out; // unterminated quote — take what we have
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trimEnd();
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
    env[name] = parseEnvValue(line.slice(eq + 1));
  }
  return env;
}

export interface AutoBuild {
  /** Shell command to run. */
  command: string;
  /** Human label for the prompt: the framework name, or a generic hint. */
  label: string;
  /** Build output dir relative to the repo root, when the framework fixes one. */
  dir?: string;
}

/**
 * Infer a build to offer before a deploy: the detected framework's build
 * command, else a `build` script in package.json. Returns null when nothing is
 * detected or the framework is static (no build step).
 */
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

async function readPackageJson(
  root: string,
): Promise<Record<string, unknown> | null> {
  try {
    return (await Bun.file(join(root, "package.json")).json()) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
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
