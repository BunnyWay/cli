import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";

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
      if (match) return { value: match[1]!, envPath };
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
    writeFileSync(target, line + "\n", "utf-8");
    return target;
  }

  const content = readFileSync(target, "utf-8");
  const regex = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m");

  if (regex.test(content)) {
    writeFileSync(target, content.replace(regex, line), "utf-8");
  } else {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    writeFileSync(target, content + separator + line + "\n", "utf-8");
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
