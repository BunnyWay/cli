import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

export const CONFIG_FILENAME = "bunny.jsonc";

// Walk up from cwd to the directory holding `bunny.jsonc`, or null when none exists.
export function findConfigRoot(): string | null {
  let dir = resolve(process.cwd());
  while (true) {
    if (existsSync(join(dir, CONFIG_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The path a command reads: an explicit `--config` path, the nearest ancestor `bunny.jsonc`, or cwd's `bunny.jsonc` as the default target.
export function configPath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;
  return join(findConfigRoot() ?? process.cwd(), CONFIG_FILENAME);
}

// Whether a `bunny.jsonc` exists at the explicit path, or anywhere up the tree.
export function configExists(explicitPath?: string): boolean {
  if (explicitPath) return existsSync(explicitPath);
  return findConfigRoot() !== null;
}

export interface RawBunnyConfig {
  /** Parsed JSONC value; validate this against the schema you need. */
  data: unknown;
  /** The `bunny.jsonc` path that was read. */
  path: string;
  /** Directory containing `bunny.jsonc`; relative paths resolve against this. */
  root: string;
}

// Locate and parse `bunny.jsonc` (walking up from cwd unless a path is given), or null when absent. Callers validate the shape they need.
export function readBunnyConfig(explicitPath?: string): RawBunnyConfig | null {
  const path = configPath(explicitPath);
  if (!existsSync(path)) return null;
  const data = parseJsonc(readFileSync(path, "utf-8"));
  return { data, path, root: dirname(path) };
}
