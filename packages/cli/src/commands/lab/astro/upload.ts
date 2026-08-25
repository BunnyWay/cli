/**
 * The client build, on its way into the zone.
 *
 * Each deploy gets its own folder, named after what is in it. So a release can
 * only read the files it was built against, and a deploy that changes nothing
 * uploads nothing.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mapWithConcurrency } from "../../../core/concurrency.ts";
import { UserError } from "../../../core/errors.ts";
import { deployPrefix } from "./naming.ts";
import { type StorageZone, zoneFiles } from "./storage.ts";

export interface LocalFile {
  /** Posix-style path relative to the client build directory. */
  path: string;
  absPath: string;
  size: number;
}

export interface HashedFile extends LocalFile {
  sha256: string;
}

const CONCURRENCY = 8;
const ATTEMPTS = 3;

// Dot-directories that carry web-visible content the site must serve.
const ALLOWED_DOT_ENTRIES = new Set([".well-known"]);

/** Dotfiles and node_modules are tooling, not content. `.well-known` is content. */
export function shouldSkipEntry(name: string): boolean {
  if (ALLOWED_DOT_ENTRIES.has(name)) return false;
  return name.startsWith(".") || name === "node_modules";
}

/** Every file in the client build, sorted by path so the hash is stable. */
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

async function hashFile(file: LocalFile): Promise<HashedFile> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file.absPath).stream()) {
    hasher.update(chunk);
  }
  return { ...file, sha256: hasher.digest("hex") };
}

/** One streaming SHA-256 per file. It feeds the deploy ID and the upload checksum. */
export function hashFiles(files: LocalFile[]): Promise<HashedFile[]> {
  return mapWithConcurrency(files, CONCURRENCY, hashFile);
}

/**
 * One name for a set of files and the code that renders them.
 *
 * The server bundle is hashed in with the files, because the bundle names the
 * hashed asset it loads. Change either half and the deploy is a different one.
 */
export function contentHash(files: HashedFile[], bundleSha: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of files) hasher.update(`${file.path}:${file.sha256}\n`);
  hasher.update(`server:${bundleSha}\n`);
  return hasher.digest("hex").slice(0, 12);
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

/**
 * Upload the client build to this deploy's folder.
 *
 * Every file carries its SHA-256, which the storage API verifies, so a truncated
 * upload fails here rather than serving half a file for a month.
 */
export async function uploadClientBuild(
  connection: StorageZone,
  deployId: string,
  files: HashedFile[],
  onUploaded?: (done: number, total: number, file: HashedFile) => void,
): Promise<void> {
  if (files.length === 0) {
    throw new UserError("Nothing to upload; the client build has no files.");
  }

  const prefix = deployPrefix(deployId);
  let done = 0;
  await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    await withRetries(() =>
      zoneFiles.upload(
        connection,
        `${prefix}/${file.path}`,
        Bun.file(file.absPath).stream(),
        { sha256Checksum: file.sha256.toUpperCase() },
      ),
    );
    done++;
    onUploaded?.(done, files.length, file);
  });
}
