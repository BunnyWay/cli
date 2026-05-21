import { existsSync, readFileSync } from "node:fs";
import type { BunnyAppConfig } from "../config.ts";
import { parseDotenv } from "./parse.ts";

/**
 * Resolution rule for `env` values in `bunny.jsonc`:
 *
 *   For each [key, value] in a container's env map, if `value` is the
 *   name of a key in the local `.env` file, send the resolved value to
 *   the API. Otherwise, send `value` literally.
 *
 * This lets `bunny.jsonc` carry pointers like:
 *
 *   "env": {
 *     "POSTGRES_DB": "orbit",                          // literal
 *     "BETTER_AUTH_SECRET": "BETTER_AUTH_SECRET",      // resolved from .env
 *     "DATABASE_URL": "PROD_DATABASE_URL"              // resolved + renamed
 *   }
 *
 * with no syntax to learn. Collisions (literal value happening to match a
 * `.env` key) are rare in practice because literals tend to be short,
 * non-identifier-shaped strings.
 *
 * Process env is intentionally not consulted — it carries unrelated
 * shell vars (PATH, HOME, …) that would silently rewrite literals.
 */
export function resolveContainerEnv(
  toml: BunnyAppConfig,
  dotenvPath: string,
): BunnyAppConfig {
  const dotenv = existsSync(dotenvPath)
    ? parseDotenv(readFileSync(dotenvPath, "utf-8"))
    : {};

  // Deep-clone so the resolved values never get written back to bunny.jsonc.
  const copy: BunnyAppConfig = structuredClone(toml);

  for (const container of Object.values(copy.app.containers)) {
    if (!container.env) continue;
    for (const [key, value] of Object.entries(container.env)) {
      if (value in dotenv) {
        container.env[key] = dotenv[value] ?? "";
      }
    }
  }

  return copy;
}
