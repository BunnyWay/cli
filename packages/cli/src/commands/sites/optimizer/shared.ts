import type { PullZoneSource } from "@/commands/pz/target.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest } from "@/core/manifest.ts";
import type { OptimizerTarget } from "@/core/optimizer/index.ts";
import type { OutputFormat } from "@/core/types.ts";
import { loadSiteConfig, saveSiteConfig } from "../config.ts";
import { SITES_MANIFEST, type SiteManifest } from "../constants.ts";
import { resolveSitePullZone, type SitePullZone } from "./site.ts";

/** Sites keep minification off: every framework already minifies its build. */
export const SITE_OPTIMIZER_MINIFY = false;

/** Keep `sites.optimizer` in bunny.jsonc from undoing a change on the next deploy; only touches a value that is already set, for the site this directory points at. */
export function syncOptimizerConfig(
  site: SitePullZone,
  enabled: boolean,
  output: OutputFormat,
): void {
  if (!site.fromDirectory) return;
  const configured = loadSiteConfig()?.config.optimizer;
  if (configured === undefined || configured === enabled) return;
  const path = saveSiteConfig({ optimizer: enabled });
  if (output !== "json") {
    logger.dim(`  Updated sites.optimizer to ${enabled} in ${path}`);
  }
}

/** A site as an Optimizer target, carrying the sites policy to whichever command reached it. */
export function siteOptimizerTarget(site: SitePullZone): OptimizerTarget {
  return {
    pullZone: site.pullZone,
    name: site.name,
    label: "Site",
    optimizer: {
      minify: SITE_OPTIMIZER_MINIFY,
      onChanged: (enabled, output) =>
        syncOptimizerConfig(site, enabled, output),
      enableHint: () =>
        site.fromDirectory && loadSiteConfig()?.config.optimizer === undefined
          ? "Keep deploys in line with it: set sites.optimizer to true in bunny.jsonc"
          : undefined,
    },
  };
}

/** A directory linked to a site (`.bunny/site.json` or `sites.name`) resolves to the site's pull zone. */
export const sitePullZoneSource: PullZoneSource<OptimizerTarget> = {
  linked: () =>
    !!(
      loadManifest<SiteManifest>(SITES_MANIFEST).id ||
      loadSiteConfig()?.config.name
    ),
  resolve: async (ctx, output) =>
    siteOptimizerTarget(await resolveSitePullZone(ctx, { output })),
};
