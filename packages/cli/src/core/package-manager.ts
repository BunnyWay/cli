import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

const LOCKFILE_TO_PM: ReadonlyArray<[string, PackageManager]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const PATH_PROBE_ORDER: ReadonlyArray<PackageManager> = [
  "bun",
  "pnpm",
  "yarn",
  "npm",
];

/** Pick the PM that owns the lockfile in `dir`, bun-first on collision. */
export function detectFromLockfile(dir: string): PackageManager | null {
  for (const [filename, pm] of LOCKFILE_TO_PM) {
    if (existsSync(join(dir, filename))) return pm;
  }
  return null;
}

/** Parse `npm_config_user_agent` (set by npx/bunx/pnpm dlx/yarn dlx). */
export function detectFromUserAgent(
  userAgent: string | undefined,
): PackageManager | null {
  if (!userAgent) return null;
  const head = userAgent.split(/\s+/)[0] ?? "";
  const name = head.split("/")[0]?.toLowerCase();
  switch (name) {
    case "bun":
    case "pnpm":
    case "yarn":
    case "npm":
      return name;
    default:
      return null;
  }
}

/** True if `name --version` runs and exits 0. Try/catch absorbs ENOENT. */
async function binaryOnPath(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([name, "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/** Pick a PM: user-agent → lockfile → first available on PATH. */
export async function pickPackageManager(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PackageManager | null> {
  const fromUserAgent = detectFromUserAgent(env.npm_config_user_agent);
  if (fromUserAgent && (await binaryOnPath(fromUserAgent))) {
    return fromUserAgent;
  }

  const fromLockfile = detectFromLockfile(dir);
  if (fromLockfile && (await binaryOnPath(fromLockfile))) {
    return fromLockfile;
  }

  for (const candidate of PATH_PROBE_ORDER) {
    if (await binaryOnPath(candidate)) return candidate;
  }
  return null;
}
