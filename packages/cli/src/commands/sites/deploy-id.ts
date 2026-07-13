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
}

/**
 * Deterministic content hash for a set of files: a merkle-style digest over
 * sorted `path + sha256` pairs, truncated to 8 hex chars. Identical content
 * always yields the same ID regardless of file order.
 */
export function contentHashId(files: HashedFile[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hasher.update(`${file.path}\0${file.sha256.toLowerCase()}\n`);
  }
  return hasher.digest("hex").slice(0, 8);
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const [code, out] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);
    return code === 0 ? out : null;
  } catch {
    // git not installed
    return null;
  }
}

/** The short HEAD sha and dirty-tree flag, or null when `cwd` isn't a git repo. */
export async function gitIdentity(
  cwd: string,
): Promise<{ sha: string; dirty: boolean } | null> {
  const sha = await git(cwd, ["rev-parse", "--short=8", "HEAD"]);
  if (!sha) return null;
  const status = await git(cwd, ["status", "--porcelain"]);
  return {
    sha: sha.trim().toLowerCase(),
    // A failed status check counts as dirty — better a content hash than a wrong sha.
    dirty: status === null || status.trim().length > 0,
  };
}

/**
 * Resolve the deploy ID: the git short-sha when the tree is clean, the
 * content hash otherwise (or outside a repo). Identical-hash deploys are
 * no-ops, so the ID must be a pure function of what actually ships.
 */
export async function resolveDeployIdentity(
  cwd: string,
  files: HashedFile[],
): Promise<DeployIdentity> {
  const gitInfo = await gitIdentity(cwd);
  if (gitInfo && !gitInfo.dirty) {
    return { id: gitInfo.sha, source: "git", gitSha: gitInfo.sha };
  }
  return {
    id: contentHashId(files),
    source: "content",
    gitSha: gitInfo?.sha,
    dirty: gitInfo?.dirty,
  };
}
