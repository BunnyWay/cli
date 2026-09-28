import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type DotenvEntry,
  type DotenvParse,
  type DotenvSpan,
  parseDotenvEntries,
  parseDotenvSpans,
} from "@/core/env.ts";
import { UserError } from "@/core/errors.ts";

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

export type EnvFileEntry = DotenvEntry;
export type EnvFileParse = DotenvParse;

/** Parse a `.env` file with the shared dotenv parser; a missing file has no entries. */
export function parseEnvFile(envPath: string): EnvFileParse {
  if (!existsSync(envPath)) return { entries: [], unterminated: [] };
  return parseDotenvEntries(readFileSync(envPath, "utf-8"));
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
    const { entries, unterminated } = parseEnvFile(envPath);
    const value = entries.findLast((entry) => entry.key === key)?.value;
    if (value) return { value, envPath };
    if (unterminated.length > 0) {
      throw new UserError(
        `Unclosed quote in ${envPath}: ${unterminated.join(", ")}.`,
      );
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Set or update a key in a `.env` file.
 * Every existing definition is replaced in place, keeping any `export ` prefix.
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
  const lines = content.split("\n");
  const spans = keySpans(content, key);

  if (spans.length > 0) {
    for (const { start, end } of spans.reverse()) {
      const prefix = lines[start]?.match(/^\s*export\s+/)?.[0] ?? "";
      lines.splice(start, end - start + 1, prefix + line);
    }
    writeFileSync(target, lines.join("\n"), "utf-8");
  } else {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    writeFileSync(target, `${content + separator + line}\n`, "utf-8");
  }

  return target;
}

/** Remove every definition of a key from a `.env` file, including multiline values. */
export function removeEnvValue(key: string, envPath: string): void {
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  const lines = content.split("\n");
  for (const { start, end } of keySpans(content, key).reverse()) {
    lines.splice(start, end - start + 1);
  }
  writeFileSync(envPath, lines.join("\n"), "utf-8");
}

function keySpans(content: string, key: string): DotenvSpan[] {
  return parseDotenvSpans(content).entries.filter((entry) => entry.key === key);
}
