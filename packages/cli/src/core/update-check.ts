import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { VERSION } from "./version.ts";

const CACHE_DIR = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  "bunnynet",
);
const CACHE_FILE = join(CACHE_DIR, "update-check.json");
const CHECK_INTERVAL = 1000 * 60 * 60 * 4; // 4 hours

interface UpdateCache {
  latest: string;
  checkedAt: number;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const resp = await fetch(
      "https://api.github.com/repos/BunnyWay/cli/releases/latest",
    );
    if (!resp.ok) return null;
    const { tag_name } = (await resp.json()) as { tag_name: string };
    return tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({ latest, checkedAt: Date.now() }),
    );
  } catch {}
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

/** Check for updates (throttled to once per 4 hours). Prints a notice to stderr if outdated. */
export async function checkForUpdate(): Promise<void> {
  try {
    const cache = readCache();
    if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL) {
      if (isNewer(cache.latest, VERSION)) {
        printUpdateNotice(cache.latest);
      }
      return;
    }

    const latest = await fetchLatestVersion();
    if (!latest) return;
    writeCache(latest);

    if (isNewer(latest, VERSION)) {
      printUpdateNotice(latest);
    }
  } catch {}
}

/** Always fetch fresh and return the latest version string (used by --version). */
export async function getLatestVersion(): Promise<string | null> {
  const latest = await fetchLatestVersion();
  if (latest) writeCache(latest);
  return latest;
}

function updateCommand(): string {
  const path = process.execPath;
  if (path.includes("@bunny.net/cli-") || path.includes("@bunny.net\\cli-")) {
    return "npm install -g @bunny.net/cli";
  }
  return "curl -fsSL https://cli.bunny.net/install.sh | sh";
}

function printUpdateNotice(latest: string): void {
  console.error(
    `\n  Update available: ${VERSION} → ${latest}` +
      `\n  Run: ${updateCommand()}\n`,
  );
}
