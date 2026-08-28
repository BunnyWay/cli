import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

export interface Workspace {
  pm: PackageManager;
  /** Where the lockfile is. The same as the project, unless the project is in a monorepo. */
  root: string;
  /** True when the project is the root of a workspace that holds other packages. */
  isRoot: boolean;
}

/** `package.json` as an object, or null when there is none to read. */
export async function readPackageJson(
  dir: string,
): Promise<Record<string, unknown> | null> {
  try {
    return (await Bun.file(join(dir, "package.json")).json()) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** True when this directory is a workspace root with packages under it. */
async function holdsPackages(dir: string): Promise<boolean> {
  const workspaceFile = await Bun.file(join(dir, "pnpm-workspace.yaml"))
    .text()
    .catch(() => null);
  // A pnpm-workspace.yaml holding only settings is not a workspace root; the
  // `packages:` key is what makes one.
  if (workspaceFile !== null && /^packages:/m.test(workspaceFile)) return true;
  const pkg = await readPackageJson(dir);
  const workspaces = pkg?.workspaces;
  return Array.isArray(workspaces)
    ? workspaces.length > 0
    : Boolean(
        (workspaces as { packages?: unknown[] } | undefined)?.packages?.length,
      );
}

/**
 * The package manager for a project, and where its workspace root is.
 *
 * The lockfile lives at the root of a monorepo, not beside each package. Looking
 * only beside the project made `starlight/docs` look like an npm project, and
 * `npm install` then met `"@astrojs/starlight": "workspace:*"` and stopped. So
 * this walks up, the way every package manager does.
 */
export async function detectWorkspace(project: string): Promise<Workspace> {
  const start = resolve(project);
  let dir = start;
  while (true) {
    const pm = detectFromLockfile(dir);
    if (pm) {
      return {
        pm,
        root: dir,
        isRoot: dir === start && (await holdsPackages(dir)),
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { pm: "npm", root: start, isRoot: await holdsPackages(start) };
}

/** The install command for one package, per package manager. A workspace root needs to be told the root is meant: pnpm refuses without `-w`, and Yarn classic wants `-W`. */
export function installCommand(workspace: Workspace, pkg: string): string {
  const root = workspace.isRoot;
  switch (workspace.pm) {
    case "npm":
      return `npm install ${pkg}`;
    case "pnpm":
      return root ? `pnpm add -w ${pkg}` : `pnpm add ${pkg}`;
    case "yarn":
      return root ? `yarn add -W ${pkg}` : `yarn add ${pkg}`;
    case "bun":
      return `bun add ${pkg}`;
  }
}

/** The uninstall command for one package, per package manager. */
export function uninstallCommand(workspace: Workspace, pkg: string): string {
  const root = workspace.isRoot;
  switch (workspace.pm) {
    case "npm":
      return `npm uninstall ${pkg}`;
    case "pnpm":
      return root ? `pnpm remove -w ${pkg}` : `pnpm remove ${pkg}`;
    case "yarn":
      return root ? `yarn remove -W ${pkg}` : `yarn remove ${pkg}`;
    case "bun":
      return `bun remove ${pkg}`;
  }
}
