import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walk up the directory tree from cwd looking for a `.env` file.
 * Returns the absolute path or `undefined` if not found.
 */
export function findEnvFile(): string | undefined {
  let dir = resolve(process.cwd());

  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) return envPath;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface EnvFileEntry {
  key: string;
  value: string;
}

export interface EnvFileParse {
  entries: EnvFileEntry[];
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
  const comment = value.search(/(^|\s)#/);
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
 * Parse a `.env` file into its entries, in file order.
 * Skips comments and blank lines, tolerates `export ` prefixes, and strips
 * one layer of matching quotes. A quoted value may span lines; one that never
 * closes is reported in `unterminated` rather than truncated, and one closed
 * by a later line's quote swallows the keys between.
 */
export function parseEnvFile(envPath: string): EnvFileParse {
  const entries: EnvFileEntry[] = [];
  const unterminated: string[] = [];
  if (!existsSync(envPath)) return { entries, unterminated };

  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line || line.startsWith("#")) continue;

    const match = line
      .replace(/^export\s+/, "")
      .match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    const key = match?.[1];
    if (!key) continue;

    const rest = (match?.[2] ?? "").trimStart();
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : undefined;
    if (!quote) {
      entries.push({ key, value: stripComment(rest) });
      continue;
    }

    let body = rest.slice(1);
    let closed = closingQuote(body, quote);
    while (closed < 0 && i + 1 < lines.length) {
      i++;
      body += `\n${lines[i] ?? ""}`;
      closed = closingQuote(body, quote);
    }
    if (closed < 0) {
      unterminated.push(key);
      continue;
    }

    const raw = body.slice(0, closed);
    entries.push({ key, value: quote === '"' ? expandEscapes(raw) : raw });
  }
  return { entries, unterminated };
}

/**
 * Read a specific key from the nearest `.env` file.
 * Returns the value and the path to the `.env` file, or `undefined` if not found.
 */
export function readEnvValue(
  key: string,
): { value: string; envPath: string } | undefined {
  let dir = resolve(process.cwd());

  while (true) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      const regex = new RegExp(
        `^${escapeRegExp(key)}\\s*=\\s*["']?(.+?)["']?\\s*$`,
        "m",
      );
      const match = content.match(regex);
      if (match?.[1]) return { value: match[1], envPath };
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Set or update a key in a `.env` file.
 * If the key already exists, the line is replaced in-place.
 * If the key doesn't exist, it's appended.
 * If no `envPath` is provided, writes to `cwd/.env` (creates if needed).
 */
export function writeEnvValue(
  key: string,
  value: string,
  envPath?: string,
): string {
  const target = envPath ?? join(process.cwd(), ".env");
  const line = `${key}=${value}`;

  if (!existsSync(target)) {
    writeFileSync(target, `${line}\n`, "utf-8");
    return target;
  }

  const content = readFileSync(target, "utf-8");
  const regex = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m");

  if (regex.test(content)) {
    writeFileSync(target, content.replace(regex, line), "utf-8");
  } else {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    writeFileSync(target, `${content + separator + line}\n`, "utf-8");
  }

  return target;
}

/**
 * Remove a key from a `.env` file.
 * Removes the entire line (including any trailing newline).
 */
export function removeEnvValue(key: string, envPath: string): void {
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  const regex = new RegExp(`^${escapeRegExp(key)}\\s*=.*\\n?`, "m");
  writeFileSync(envPath, content.replace(regex, ""), "utf-8");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
