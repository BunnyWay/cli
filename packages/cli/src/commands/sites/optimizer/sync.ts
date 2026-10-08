import type { ToolContext } from "@bunny.net/tools";
import {
  OPTIMIZER_MONTHLY_PRICE,
  pullZonesOptimizerGet,
  pullZonesOptimizerSet,
} from "@bunny.net/tools/pullzones";
import { errorMessage } from "@/core/errors.ts";
import { formatBytes } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, withSpinner } from "@/core/ui.ts";
import { saveSiteConfig } from "../config.ts";
import { formatPrice } from "./shared.ts";

/**
 * Bring the site's pull zone in line with `sites.optimizer` before a deploy publishes (the publish purges, so no separate purge here).
 *
 * Turning it on costs money, so the first time asks in a terminal; unattended, the config value is the consent. Turning it off never asks.
 */
export async function syncOptimizer(opts: {
  ctx: ToolContext;
  pullZone: number;
  site: string;
  enabled: boolean;
  output: OutputFormat;
}): Promise<void> {
  const { ctx, pullZone, site, enabled, output } = opts;
  const quiet = output === "json";
  const status = await withSpinner("Checking Bunny Optimizer...", () =>
    pullZonesOptimizerGet.invoke(ctx, { pullZone }),
  );
  if (status.enabled === enabled && status.configured) return;

  const price = formatPrice(status.monthlyPrice);
  if (enabled && !status.enabled) {
    if (isInteractive(output)) {
      const accepted = await confirm(
        `sites.optimizer is true in bunny.jsonc. Turn on Bunny Optimizer for ${site}? It costs ${price}.`,
        { initial: true, optional: true },
      );
      if (!accepted) {
        logger.warn("Bunny Optimizer stays off for this deploy.");
        logger.dim(
          "  Set sites.optimizer to false in bunny.jsonc to stop this prompt.",
        );
        return;
      }
    } else if (!quiet) {
      logger.info(
        `Turning on Bunny Optimizer (${price}) because sites.optimizer is true in bunny.jsonc.`,
      );
    }
  }

  await withSpinner(
    enabled
      ? "Turning on Bunny Optimizer..."
      : "Turning off Bunny Optimizer...",
    () =>
      pullZonesOptimizerSet.invoke(ctx, { pullZone, enabled, purge: false }),
  );
  if (!quiet) {
    logger.success(
      enabled
        ? status.enabled
          ? "Re-applied the Bunny Optimizer settings."
          : `Bunny Optimizer is on for ${site}.`
        : `Bunny Optimizer is off for ${site}.`,
    );
  }
}

// Formats Optimizer converts and resizes.
const OPTIMIZABLE_IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/** Below this, the saving isn't worth a line of output. */
export const OPTIMIZER_HINT_MIN_BYTES = 1024 * 1024;

export function optimizableImages(files: { path: string; size: number }[]): {
  count: number;
  bytes: number;
} {
  const images = files.filter((f) => OPTIMIZABLE_IMAGE.test(f.path));
  return {
    count: images.length,
    bytes: images.reduce((sum, f) => sum + f.size, 0),
  };
}

/** One line after a deploy whose images Optimizer would shrink; never in CI, and gone once `sites.optimizer` is set either way. */
export async function offerOptimizer(opts: {
  ctx: ToolContext;
  pullZone: number;
  files: { path: string; size: number }[];
}): Promise<void> {
  const { count, bytes } = optimizableImages(opts.files);
  if (bytes < OPTIMIZER_HINT_MIN_BYTES) return;
  try {
    const status = await pullZonesOptimizerGet.invoke(opts.ctx, {
      pullZone: opts.pullZone,
    });
    if (status.enabled) return;
    logger.log();
    logger.info(
      `Your build has ${count} images (${formatBytes(bytes)}). Bunny Optimizer serves them as WebP sized for each device, for ${formatPrice(status.monthlyPrice)}: bunny sites optimizer enable`,
    );
    logger.dim("  Hide this: set sites.optimizer to false in bunny.jsonc");
  } catch {
    // A hint never fails a deploy.
  }
}

/** The create flow's offer, next to the custom domain one. Never fails the create: the site already exists. */
export async function offerOptimizerOnCreate(opts: {
  ctx: ToolContext;
  pullZone: number;
  site: string;
}): Promise<void> {
  const price = formatPrice(OPTIMIZER_MONTHLY_PRICE);
  const accepted = await confirm(
    `Turn on Bunny Optimizer? Images are served as WebP sized for each device, for ${price}.`,
    { initial: false, optional: true },
  );
  if (!accepted) return;
  try {
    // A new site has nothing cached yet, so there's nothing to purge.
    await withSpinner("Turning on Bunny Optimizer...", () =>
      pullZonesOptimizerSet.invoke(opts.ctx, {
        pullZone: opts.pullZone,
        enabled: true,
        purge: false,
      }),
    );
    const path = saveSiteConfig({ optimizer: true });
    logger.success(`Bunny Optimizer is on for ${opts.site}.`);
    logger.dim(`  Saved sites.optimizer: true to ${path}`);
  } catch (err) {
    logger.warn(`Couldn't turn on Bunny Optimizer: ${errorMessage(err)}`);
    logger.dim(`  Retry later: bunny sites optimizer enable ${opts.site}`);
  }
}
