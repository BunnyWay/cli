import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

/** Dotfiles/dirs and node_modules never ship — they're tooling, not site content. */
export function shouldSkipEntry(name: string): boolean {
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

/** Streaming SHA-256 for each file — feeds both the deploy ID and upload checksums. */
export async function hashFiles(
  files: LocalFile[],
): Promise<HashedLocalFile[]> {
  const hashed: HashedLocalFile[] = [];
  for (const file of files) {
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of Bun.file(file.absPath).stream()) {
      hasher.update(chunk);
    }
    hashed.push({ ...file, sha256: hasher.digest("hex") });
  }
  return hashed;
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

/**
 * Upload a deploy's files to `deploys/{id}/...` with bounded concurrency,
 * per-file SHA-256 checksums (server-verified), and retry with backoff.
 */
export async function uploadDeploy(
  connection: StorageZone,
  deployId: string,
  files: HashedLocalFile[],
  opts?: UploadDeployOptions,
): Promise<void> {
  if (files.length === 0) {
    throw new UserError("Nothing to upload — the deploy has no files.");
  }

  const prefix = deployPrefix(deployId);
  const concurrency = Math.max(
    1,
    Math.min(opts?.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY, files.length),
  );

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      const file = files[index];
      if (!file) return;
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
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}
