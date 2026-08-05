import { UserError } from "./errors.ts";

const ENV_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Throw when `key` isn't a legal environment variable name. */
export function assertEnvKey(key: string): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new UserError(`Invalid environment variable name: "${key}"`);
  }
}

/** Split a `KEY=VALUE` string on the first `=`, validating the key. */
export function splitPair(entry: string): [string, string] {
  const eq = entry.indexOf("=");
  if (eq === -1) {
    throw new UserError(`Invalid env entry "${entry}". Expected KEY=VALUE.`);
  }
  const key = entry.slice(0, eq);
  assertEnvKey(key);
  return [key, entry.slice(eq + 1)];
}

// Double-quoted values read to the closing quote, unescaping `\"`/`\\` (a `#` inside stays literal); single quotes are verbatim; unquoted values drop a whitespace-delimited inline `# comment`.
function parseValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    let out = "";
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\" && i + 1 < value.length) out += value[++i];
      else if (ch === '"') return out;
      else out += ch;
    }
    return out; // unterminated quote: take what we have
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trimEnd();
}

/** Parse a dotenv file: KEY=VALUE lines, `#` comments, optional `export`, optional quotes; invalid lines are skipped. */
export function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    if (!ENV_KEY_PATTERN.test(key)) continue;
    env[key] = parseValue(body.slice(eq + 1));
  }
  return env;
}

/** Merge env vars from a dotenv file (loaded first) and `KEY=VALUE` entries (which override the file). */
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
