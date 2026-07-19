import { type SiteConfig, SiteConfigSchema } from "@bunny.net/config";
import { readBunnyConfig } from "../../core/bunny-config.ts";
import { UserError } from "../../core/errors.ts";

export interface LoadedSiteConfig {
  config: SiteConfig;
  /** Directory containing bunny.jsonc; `sites.dir` resolves against this. */
  root: string;
}

// Read the optional `sites` block from `bunny.jsonc` (walking up from cwd); only that block is validated, so a sites-only file works without an `app` block (or even a `version`) and a file with no `sites` block returns null.
export function loadSiteConfig(): LoadedSiteConfig | null {
  const found = readBunnyConfig();
  if (!found) return null;

  const sites = (found.data as Record<string, unknown> | null)?.sites;
  if (sites === undefined || sites === null) return null;

  const parsed = SiteConfigSchema.safeParse(sites);
  if (!parsed.success) {
    throw new UserError(
      `Invalid \`sites\` block in ${found.path}.`,
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "sites"}: ${i.message}`)
        .join("; "),
    );
  }
  return { config: parsed.data, root: found.root };
}
