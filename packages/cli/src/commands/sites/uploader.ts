import { readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { StorageZone } from "@/commands/storage/files-api.ts";
import { mapWithConcurrency } from "@/core/concurrency.ts";
import { errorMessage, UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { siteFiles } from "./api.ts";
import { deployPrefix } from "./constants.ts";

interface LocalFile {
  /** Posix-style path relative to the deploy root. */
  path: string;
  absPath: string;
  size: number;
}

interface HashedLocalFile extends LocalFile {
  sha256: string;
}

const UPLOAD_CONCURRENCY = 8;
const UPLOAD_ATTEMPTS = 3;

// Dot-directories that carry web-visible content the site must serve.
const ALLOWED_DOT_ENTRIES = new Set([".well-known"]);

// Dotfiles/dirs and node_modules never ship (tooling, not content), except standards dirs like `.well-known` that must be served.
function shouldSkipEntry(name: string): boolean {
  if (ALLOWED_DOT_ENTRIES.has(name)) return false;
  return name.startsWith(".") || name === "node_modules";
}

/** Recursively collect the files to deploy, sorted by path for determinism. */
export function collectFiles(dir: string): LocalFile[] {
  const files: LocalFile[] = [];
  // Real paths of the directories on the current walk, so a symlink back up the tree can't loop.
  const ancestors = new Set<string>();
  const rootReal = realpathSync(dir);

  // A link may only resolve to deployable content inside the deploy dir, so `config -> ../.env` can't publish a private file.
  const linkStaysInside = (entryAbs: string): boolean => {
    let target: string;
    try {
      target = realpathSync(entryAbs);
    } catch {
      return true; // Dangling: statSync below finds nothing and it's skipped.
    }
    const rel = relative(rootReal, target);
    return (
      !rel.startsWith("..") &&
      !isAbsolute(rel) &&
      !rel.split(sep).some((part) => part && shouldSkipEntry(part))
    );
  };

  const walk = (abs: string, rel: string) => {
    const real = realpathSync(abs);
    if (ancestors.has(real)) return;
    ancestors.add(real);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (shouldSkipEntry(entry.name)) continue;
      const entryAbs = join(abs, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() && !linkStaysInside(entryAbs)) {
        logger.warn(
          `Skipped ${entryRel}: it links outside the deploy directory or to an excluded path.`,
        );
        continue;
      }
      // statSync follows symlinks, so linked files and dirs ship as their targets.
      const stat = entry.isSymbolicLink()
        ? statSync(entryAbs, { throwIfNoEntry: false })
        : entry;
      if (stat?.isDirectory()) {
        walk(entryAbs, entryRel);
      } else if (stat?.isFile()) {
        files.push({
          path: entryRel,
          absPath: entryAbs,
          size: statSync(entryAbs).size,
        });
      }
      // Sockets, FIFOs, and dangling symlinks are silently skipped.
    }
    ancestors.delete(real);
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
  return mapWithConcurrency(files, UPLOAD_CONCURRENCY, hashFile);
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

interface UploadDeployOptions {
  onFileUploaded?: (done: number, total: number, file: HashedLocalFile) => void;
}

// Upload a deploy's files to `deploys/{id}/...` with bounded concurrency, server-verified per-file SHA-256 checksums, and retry with backoff.
export async function uploadDeploy(
  connection: StorageZone,
  deployId: string,
  files: HashedLocalFile[],
  opts?: UploadDeployOptions,
): Promise<void> {
  const prefix = deployPrefix(deployId);
  let done = 0;
  await mapWithConcurrency(files, UPLOAD_CONCURRENCY, async (file) => {
    await withRetries(() =>
      siteFiles.upload(
        connection,
        `${prefix}/${file.path}`,
        Bun.file(file.absPath).stream(),
        { sha256Checksum: file.sha256.toUpperCase() },
      ),
    ).catch((err) => {
      throw new UserError(
        `Uploading ${file.path} failed: ${errorMessage(err)}`,
        "Re-run the deploy; nothing goes live until every file is uploaded.",
      );
    });
    done++;
    opts?.onFileUploaded?.(done, files.length, file);
  });
}
