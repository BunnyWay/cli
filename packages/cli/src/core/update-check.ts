import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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

/** Call at startup — prints a notice if a newer version was found on the last check. */
export function notifyIfUpdateAvailable(): void {
  try {
    if (!existsSync(CACHE_FILE)) return;
    const cache: UpdateCache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (cache.latest !== VERSION && isNewer(cache.latest, VERSION)) {
      console.error(
        `\n  Update available: ${VERSION} → ${cache.latest}` +
          `\n  Run: curl -fsSL https://github.com/BunnyWay/cli/raw/main/install.sh | sh\n`,
      );
    }
  } catch {}
}

/** Call after a command completes — spawns a detached fetch so the CLI exits immediately. */
export function scheduleUpdateCheck(): void {
  try {
    if (existsSync(CACHE_FILE)) {
      const cache: UpdateCache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
      if (Date.now() - cache.checkedAt < CHECK_INTERVAL) return;
    }

    const script = `
const resp = await fetch("https://api.github.com/repos/BunnyWay/cli/releases/latest");
if (!resp.ok) process.exit(0);
const { tag_name } = await resp.json();
const latest = tag_name.replace(/^v/, "");
const fs = require("fs");
fs.mkdirSync(${JSON.stringify(CACHE_DIR)}, { recursive: true });
fs.writeFileSync(${JSON.stringify(CACHE_FILE)}, JSON.stringify({ latest, checkedAt: Date.now() }));
`;

    const child = Bun.spawn(["bun", "-e", script], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.unref();
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
