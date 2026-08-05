import { runGit } from "../../core/git.ts";

export interface HashedFile {
  /** Posix-style path relative to the deploy root. */
  path: string;
  /** Lowercase or uppercase hex SHA-256 of the file contents. */
  sha256: string;
}

export interface DeployIdentity {
  id: string;
  source: "git" | "content";
  gitSha?: string;
  dirty?: boolean;
  // Hash of the deployed bytes; the no-op check keys on this (not `id`), so a rebuilt `dist/` at the same git sha isn't wrongly skipped.
  contentHash: string;
}

// Deterministic content hash: a digest over sorted `path + sha256` pairs, truncated to 12 hex chars (48 bits); same content yields the same hash regardless of file order.
export function contentHashId(files: HashedFile[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hasher.update(`${file.path}\0${file.sha256.toLowerCase()}\n`);
  }
  return hasher.digest("hex").slice(0, 12);
}

/** The short HEAD sha and dirty-tree flag, or null when `cwd` isn't a git repo. */
export async function gitIdentity(
  cwd: string,
): Promise<{ sha: string; dirty: boolean } | null> {
  const sha = await runGit(cwd, ["rev-parse", "--short=8", "HEAD"]);
  if (!sha) return null;
  const status = await runGit(cwd, ["status", "--porcelain"]);
  return {
    sha: sha.toLowerCase(),
    // A failed status check counts as dirty: better a content hash than a wrong sha.
    dirty: status === null || status.length > 0,
  };
}

// Resolve the deploy identity: display `id` is the git short-sha on a clean tree, else the content hash; `contentHash` always hashes what ships and drives the no-op check.
export async function resolveDeployIdentity(
  cwd: string,
  files: HashedFile[],
): Promise<DeployIdentity> {
  const contentHash = contentHashId(files);
  const gitInfo = await gitIdentity(cwd);
  if (gitInfo && !gitInfo.dirty) {
    return { id: gitInfo.sha, source: "git", gitSha: gitInfo.sha, contentHash };
  }
  return {
    id: contentHash,
    source: "content",
    gitSha: gitInfo?.sha,
    dirty: gitInfo?.dirty,
    contentHash,
  };
}
