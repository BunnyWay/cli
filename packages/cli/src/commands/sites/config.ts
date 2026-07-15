import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type SiteConfig, SiteConfigSchema } from "@bunny.net/app-config";
import { parse as parseJsonc } from "jsonc-parser";
import { UserError } from "../../core/errors.ts";

const CONFIG_FILENAME = "bunny.jsonc";

export interface LoadedSiteConfig {
  config: SiteConfig;
  /** Directory containing bunny.jsonc; `sites.dir` resolves against this. */
  root: string;
}

// Read the optional `sites` block from `bunny.jsonc` (walking up from cwd); only that block is validated, so a sites-only file works without an `app` block and a file with no `sites` block returns null.
export function loadSiteConfig(): LoadedSiteConfig | null {
  let dir = resolve(process.cwd());
  while (true) {
    const path = join(dir, CONFIG_FILENAME);
    if (existsSync(path)) {
      const raw = parseJsonc(readFileSync(path, "utf-8"));
      const sites = (raw as Record<string, unknown> | null)?.sites;
      if (sites === undefined || sites === null) return null;

      const parsed = SiteConfigSchema.safeParse(sites);
      if (!parsed.success) {
        throw new UserError(
          `Invalid \`sites\` block in ${path}.`,
          parsed.error.issues
            .map((i) => `${i.path.join(".") || "sites"}: ${i.message}`)
            .join("; "),
        );
      }
      return { config: parsed.data, root: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
