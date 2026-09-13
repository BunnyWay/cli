import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CURRENT_VERSION,
  type SiteConfig,
  SiteConfigSchema,
} from "@bunny.net/config";
import {
  configPath,
  readBunnyConfig,
  SCHEMA_REF,
} from "@/core/bunny-config.ts";
import { UserError } from "@/core/errors.ts";
import { syncJsonc } from "@/core/jsonc.ts";

export interface LoadedSiteConfig {
  config: SiteConfig;
  /** Directory containing bunny.jsonc; `sites.dir` resolves against this. */
  root: string;
}

// Read the `sites` block from `bunny.jsonc`, validating only that block so a sites-only file needs no `app` (or `version`); returns null when no file or no `sites` block.
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

/** Merge `patch` into the `sites` block of the nearest `bunny.jsonc` (or a fresh one in cwd); surgical, so comments survive. */
export function saveSiteConfig(
  patch: Partial<SiteConfig>,
  explicitPath?: string,
): string {
  const path = explicitPath ?? configPath();
  if (!existsSync(path)) {
    const fresh = {
      $schema: SCHEMA_REF,
      version: CURRENT_VERSION,
      sites: patch,
    };
    writeFileSync(path, `${JSON.stringify(fresh, null, 2)}\n`);
    return path;
  }
  const text = readFileSync(path, "utf-8");
  const existing = (readBunnyConfig(path)?.data ?? {}) as Record<
    string,
    unknown
  >;
  const sites = (existing.sites ?? {}) as Record<string, unknown>;
  writeFileSync(
    path,
    syncJsonc(text, { ...existing, sites: { ...sites, ...patch } }),
  );
  return path;
}
