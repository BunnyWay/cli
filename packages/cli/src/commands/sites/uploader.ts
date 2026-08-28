import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mapWithConcurrency } from "../../core/concurrency.ts";
import { UserError } from "../../core/errors.ts";
import type { StorageZone } from "../storage/files-api.ts";
import { siteFiles } from "./api.ts";
import { deployPrefix } from "./constants.ts";

export interface LocalFile {
  /** Posix-style path relative to the deploy root. */
  path: string;
  absPath: string;
  size: number;
}

export interface HashedLocalFile extends LocalFile {
  sha256: string;
}

export const DEFAULT_UPLOAD_CONCURRENCY = 8;
const UPLOAD_ATTEMPTS = 3;

// Dot-directories that carry web-visible content the site must serve.
const ALLOWED_DOT_ENTRIES = new Set([".well-known"]);

// Dotfiles/dirs and node_modules never ship (tooling, not content), except standards dirs like `.well-known` that must be served.
export function shouldSkipEntry(name: string): boolean {
  if (ALLOWED_DOT_ENTRIES.has(name)) return false;
  return name.startsWith(".") || name === "node_modules";
}

/** Recursively collect the files to deploy, sorted by path for determinism. */
export function collectFiles(dir: string): LocalFile[] {
  const files: LocalFile[] = [];

  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (shouldSkipEntry(entry.name)) continue;
      const entryAbs = join(abs, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(entryAbs, entryRel);
      } else if (entry.isFile()) {
        files.push({
          path: entryRel,
          absPath: entryAbs,
          size: statSync(entryAbs).size,
        });
      }
      // Sockets, FIFOs, and dangling symlinks are silently skipped.
    }
  };

  walk(dir, "");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function hashFile(file: LocalFile): Promise<HashedLocalFile> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file.absPath).stream()) {
    hasher.update(chunk);
  }
  return { ...file, sha256: hasher.digest("hex") };
}

// Streaming SHA-256 per file feeds both the deploy ID and upload checksums; concurrency matches the upload step.
export async function hashFiles(
  files: LocalFile[],
): Promise<HashedLocalFile[]> {
  return mapWithConcurrency(files, DEFAULT_UPLOAD_CONCURRENCY, hashFile);
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < UPLOAD_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export interface UploadDeployOptions {
  concurrency?: number;
  onFileUploaded?: (done: number, total: number, file: HashedLocalFile) => void;
}

// Upload a deploy's files to `deploys/{id}/...` with bounded concurrency, server-verified per-file SHA-256 checksums, and retry with backoff.
export async function uploadDeploy(
  connection: StorageZone,
  deployId: string,
  files: HashedLocalFile[],
  opts?: UploadDeployOptions,
): Promise<void> {
  if (files.length === 0) {
    throw new UserError("Nothing to upload; the deploy has no files.");
  }

  const prefix = deployPrefix(deployId);
  let done = 0;
  await mapWithConcurrency(
    files,
    opts?.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY,
    async (file) => {
      await withRetries(() =>
        siteFiles.upload(
          connection,
          `${prefix}/${file.path}`,
          Bun.file(file.absPath).stream(),
          { sha256Checksum: file.sha256.toUpperCase() },
        ),
      );
      done++;
      opts?.onFileUploaded?.(done, files.length, file);
    },
  );
}

// Every object under a deploy's prefix, as paths relative to it.
async function listDeployObjects(
  connection: StorageZone,
  prefix: string,
  dir = "",
): Promise<string[]> {
  const entries = await siteFiles.list(connection, `${prefix}/${dir}`);
  const paths: string[] = [];
  for (const entry of entries) {
    const rel = `${dir}${entry.objectName}`;
    if (entry.isDirectory) {
      paths.push(...(await listDeployObjects(connection, prefix, `${rel}/`)));
    } else {
      paths.push(rel);
    }
  }
  return paths;
}

/**
 * Delete objects an earlier upload of the same deploy ID left behind.
 *
 * Re-uploading writes the new files but never removes ones the artifact has
 * dropped, so without this a replaced deploy serves a mix of both. Runs after
 * the new files are in place, so a live deploy is never missing a file mid-replace.
 * Returns the paths removed.
 */
export async function pruneDeployOrphans(
  connection: StorageZone,
  deployId: string,
  files: HashedLocalFile[],
): Promise<string[]> {
  const prefix = deployPrefix(deployId);
  const keep = new Set(files.map((file) => file.path));
  const orphans = (await listDeployObjects(connection, prefix)).filter(
    (path) => !keep.has(path),
  );

  await mapWithConcurrency(
    orphans,
    DEFAULT_UPLOAD_CONCURRENCY,
    async (path) => {
      await withRetries(() =>
        siteFiles.remove(connection, `${prefix}/${path}`),
      );
    },
  );
  return orphans;
}
