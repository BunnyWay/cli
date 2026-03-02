import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { UserError } from "./errors.ts";

const MANIFEST_DIR = ".bunny";

export interface ManifestData {
  id?: number;
  name?: string;
  scriptType?: number;
}

/**
 * Walk up the directory tree looking for a `.bunny/<filename>` file.
 * Returns the project root (the directory containing `.bunny/`),
 * or the current working directory if none is found.
 */
function findRoot(filename: string): string {
  let dir = resolve(process.cwd());

  while (true) {
    const manifestPath = join(dir, MANIFEST_DIR, filename);
    if (existsSync(manifestPath)) return dir;

    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function manifestPath(filename: string): string {
  return join(findRoot(filename), MANIFEST_DIR, filename);
}

export function manifestDir(filename: string): string {
  return join(findRoot(filename), MANIFEST_DIR);
}

/** Load a manifest from `.bunny/<filename>`. Returns empty data if the file doesn't exist. */
export function loadManifest(filename: string): ManifestData {
  const path = manifestPath(filename);

  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Save a manifest to `.bunny/<filename>`. Creates the directory if needed. */
export function saveManifest(filename: string, data: ManifestData): void {
  const dir = manifestDir(filename);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, filename),
    JSON.stringify(data, null, 2) + "\n",
    { mode: 0o600 },
  );
}

/** Save a manifest to `.bunny/<filename>` within a specific root directory. */
export function saveManifestAt(root: string, filename: string, data: ManifestData): void {
  const dir = join(root, MANIFEST_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, filename),
    JSON.stringify(data, null, 2) + "\n",
    { mode: 0o600 },
  );
}

/**
 * Resolve a resource ID from an explicit value or the manifest context file.
 *
 * Resolution order:
 * 1. Explicit `id` (from a positional arg or `--script-id` flag)
 * 2. `.bunny/<filename>` in the current or ancestor directory
 *
 * Throws if neither source provides an ID.
 */
export function resolveManifestId(
  filename: string,
  id: number | undefined,
  resourceType: string,
): number {
  if (id) return id;

  const manifest = loadManifest(filename);
  if (manifest.id) return manifest.id;

  throw new UserError(
    `No ${resourceType} ID provided and no linked ${resourceType} found.`,
    `Run \`bunny scripts link\` or pass an ID explicitly.`,
  );
}
