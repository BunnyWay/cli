import type { Argv } from "yargs";
import { UserError } from "../../core/errors.ts";

const ENV_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Add the shared `--env`/`--env-file` options to a command builder.
 *  Pass `{ shortAlias: false }` on commands that forward arbitrary argv so that
 *  `-e` is not consumed by yargs before reaching the remote process. */
export function withEnvOptions<T>(
  yargs: Argv<T>,
  { shortAlias = true }: { shortAlias?: boolean } = {},
): Argv<T> {
  return yargs
    .option("env", {
      ...(shortAlias ? { alias: "e" } : {}),
      type: "string",
      array: true,
      // One value per flag; a greedy array would swallow `-- <command>`.
      nargs: 1,
      describe: "Set an environment variable as KEY=VALUE (repeatable)",
    })
    .option("env-file", {
      type: "string",
      describe: "Load environment variables from a dotenv file",
    });
}

/** Fields yargs populates for the shared env options. */
export interface EnvOptionArgs {
  env?: string[];
  envFile?: string;
}

/**
 * Merge env vars from a `--env-file` (loaded first) and `KEY=VALUE` entries
 * (which override the file). Both key and value are validated.
 */
export async function collectEnv(
  entries: string[] = [],
  envFile?: string,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  if (envFile) {
    const file = Bun.file(envFile);
    if (!(await file.exists())) {
      throw new UserError(`Env file not found: ${envFile}`);
    }
    Object.assign(env, parseDotenv(await file.text()));
  }
  for (const entry of entries) {
    const [key, value] = splitPair(entry);
    env[key] = value;
  }
  return env;
}

/** Split a `KEY=VALUE` string on the first `=`, validating the key. */
export function splitPair(entry: string): [string, string] {
  const eq = entry.indexOf("=");
  if (eq === -1) {
    throw new UserError(`Invalid env entry "${entry}". Expected KEY=VALUE.`);
  }
  const key = entry.slice(0, eq);
  assertValidKey(key);
  return [key, entry.slice(eq + 1)];
}

/** Minimal dotenv parser: KEY=VALUE lines, `#` comments, optional quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    assertValidKey(key);
    let value = body.slice(eq + 1).trim();
    const quote = value[0];
    if (
      value.length >= 2 &&
      (quote === '"' || quote === "'") &&
      value.endsWith(quote)
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    }
    env[key] = value;
  }
  return env;
}

function assertValidKey(key: string): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new UserError(`Invalid environment variable name: "${key}"`);
  }
}
