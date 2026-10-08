import type { OptimizerStatus } from "@bunny.net/tools/pullzones";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { loadSiteConfig, saveSiteConfig } from "../config.ts";
import type { SitePullZone } from "./site.ts";

export function formatPrice(monthly: number): string {
  return `$${monthly.toFixed(2)}/month`;
}

export function renderOptimizerStatus(
  site: string,
  status: OptimizerStatus,
  output: OutputFormat,
): void {
  const onOff = (on: boolean) => (on ? "on" : "off");
  const cacheKey =
    status.cacheKeyParameters === null
      ? "all query parameters"
      : status.cacheKeyParameters.length === 0
        ? "query strings ignored"
        : status.cacheKeyParameters.join(", ");
  logger.log(
    formatKeyValue(
      [
        { key: "Site", value: site },
        { key: "Optimizer", value: onOff(status.enabled) },
        { key: "WebP", value: onOff(status.webp) },
        { key: "Dynamic images", value: onOff(status.dynamicImages) },
        {
          key: "Minify CSS/JS",
          value: `${onOff(status.minify.css)}/${onOff(status.minify.js)}`,
        },
        { key: "Cache key", value: cacheKey },
        { key: "Price", value: formatPrice(status.monthlyPrice) },
      ],
      output,
    ),
  );
}

/** Keep `sites.optimizer` in bunny.jsonc from undoing a change on the next deploy; only touches a value that is already set, for the site this directory points at. */
export function syncOptimizerConfig(
  site: SitePullZone | undefined,
  enabled: boolean,
  output: OutputFormat,
): void {
  if (!site?.fromDirectory) return;
  const configured = loadSiteConfig()?.config.optimizer;
  if (configured === undefined || configured === enabled) return;
  const path = saveSiteConfig({ optimizer: enabled });
  if (output !== "json") {
    logger.dim(`  Updated sites.optimizer to ${enabled} in ${path}`);
  }
}
