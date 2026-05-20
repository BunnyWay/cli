import { existsSync } from "node:fs";
import { join } from "node:path";

// In priority order. `compose.yml` is the modern canonical name.
const CANDIDATES = [
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
];

/**
 * Find a compose file at the given directory. Returns the absolute
 * path of the first match, or null if none exist.
 */
export function findComposeFile(dir: string): string | null {
  for (const candidate of CANDIDATES) {
    const path = join(dir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}
