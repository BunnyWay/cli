import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { loadSiteConfig, saveSiteConfig } from "../config.ts";
import type { SitePullZone } from "./site.ts";

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
