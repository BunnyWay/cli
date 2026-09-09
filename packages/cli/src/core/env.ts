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

export interface DotenvEntry {
  key: string;
  value: string;
}

export interface DotenvParse {
  entries: DotenvEntry[];
  unterminated: string[];
}

const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "\\": "\\",
  '"': '"',
};

function expandEscapes(value: string): string {
  return value.replace(/\\(.)/g, (whole, ch: string) => ESCAPES[ch] ?? whole);
}

function stripComment(value: string): string {
  const comment = value.search(/\s#/);
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

function closingQuote(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === "\\") {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

/**
 * Parse dotenv text into its entries, in file order.
 * Skips comments and blank lines, tolerates `export ` prefixes, strips one
 * layer of matching quotes, and expands escapes in double quotes. A quoted
 * value may span lines; one that never closes is reported in `unterminated`
 * rather than truncated, and one closed by a later line's quote swallows the
 * keys between.
 */
export function parseDotenvEntries(text: string): DotenvParse {
  const entries: DotenvEntry[] = [];
  const unterminated: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line || line.startsWith("#")) continue;

    const body = line.replace(/^export\s+/, "");
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    if (!ENV_KEY_PATTERN.test(key)) continue;

    const rest = body.slice(eq + 1).trimStart();
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : undefined;
    if (!quote) {
      entries.push({ key, value: stripComment(rest) });
      continue;
    }

    let quoted = rest.slice(1);
    let closed = closingQuote(quoted, quote);
    while (closed < 0 && i + 1 < lines.length) {
      i++;
      quoted += `\n${lines[i] ?? ""}`;
      closed = closingQuote(quoted, quote);
    }
    if (closed < 0) {
      unterminated.push(key);
      continue;
    }

    const raw = quoted.slice(0, closed);
    entries.push({ key, value: quote === '"' ? expandEscapes(raw) : raw });
  }
  return { entries, unterminated };
}

/** Parse dotenv text into a map; later keys win, and an unclosed quote drops its key. */
export function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of parseDotenvEntries(text).entries) {
    env[key] = value;
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
    const { entries, unterminated } = parseDotenvEntries(await file.text());
    if (unterminated.length > 0) {
      throw new UserError(
        `Unclosed quote in ${envFile}: ${unterminated.join(", ")}.`,
        "Close the quote so the value is not sent truncated.",
      );
    }
    for (const { key, value } of entries) env[key] = value;
  }
  for (const entry of entries) {
    const [key, value] = splitPair(entry);
    env[key] = value;
  }
  return env;
}
