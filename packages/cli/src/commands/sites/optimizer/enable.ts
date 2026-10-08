import {
  pullZonesOptimizerGet,
  pullZonesOptimizerSet,
} from "@bunny.net/tools/pullzones";
import { DONE, defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import { loadSiteConfig } from "../config.ts";
import { sitePositionalBuilder } from "../interactive.ts";
import { formatPrice, syncOptimizerConfig } from "./shared.ts";
import { resolveSitePullZone, type SitePullZone } from "./site.ts";

const sites = new WeakMap<object, SitePullZone>();

export const sitesOptimizerEnableCommand = defineToolCommand({
  tool: pullZonesOptimizerSet,
  command: "enable [site]",
  describe:
    "Turn on Bunny Optimizer: images served as WebP and sized for each device.",
  examples: [
    ["$0 sites optimizer enable", "Turn it on for the linked site"],
    ["$0 sites optimizer enable my-site --yes", "Skip the price confirmation"],
  ],
  epilogue:
    "Optimizer is billed monthly per site. Turning it on also adds the Dynamic Image API (?width=, ?quality=, ...) for srcset loaders, keys the cache on those parameters only, turns minification off (frameworks already minify), and purges the cache.",
  progress: "Turning on Bunny Optimizer...",

  builder: (yargs) =>
    sitePositionalBuilder(yargs).option("force", {
      type: "boolean",
      alias: ["yes", "y"],
      default: false,
      describe: "Skip the price confirmation",
    }),

  prepare: async (args, ctx) => {
    const site = await resolveSitePullZone(ctx, args);
    sites.set(args, site);
    const status = await withSpinner("Fetching Optimizer status...", () =>
      pullZonesOptimizerGet.invoke(ctx, { pullZone: site.pullZone }),
    );
    if (status.enabled && status.configured) {
      if (args.output === "json") {
        logger.log(
          JSON.stringify({ ...status, changed: false, purged: false }, null, 2),
        );
      } else {
        logger.info(`Bunny Optimizer is already on for ${site.name}.`);
      }
      syncOptimizerConfig(site, true, args.output);
      return DONE;
    }
    // Already paying: re-applying the settings needs no consent.
    if (status.enabled) {
      return { input: { pullZone: site.pullZone, enabled: true } };
    }

    const price = formatPrice(status.monthlyPrice);
    requireConfirmable(args.output, {
      force: args.force,
      message: `Bunny Optimizer costs ${price} for ${site.name}; turning it on needs a confirmation prompt.`,
      hint: "Re-run with --yes to accept the price non-interactively.",
    });
    return {
      input: { pullZone: site.pullZone, enabled: true },
      confirm: () =>
        confirm(
          `Turn on Bunny Optimizer for ${site.name}? It costs ${price}.`,
          { force: args.force, initial: true },
        ),
    };
  },

  after: (_, args) => syncOptimizerConfig(sites.get(args), true, args.output),

  render: (result, args) => {
    const name = sites.get(args)?.name ?? `pull zone ${result.pullZone}`;
    logger.success(
      result.changed
        ? `Bunny Optimizer is on for ${name}${result.purged ? " (cache purged)" : ""}.`
        : `Bunny Optimizer is already on for ${name}.`,
    );
    logger.dim(
      "  Images are now served as WebP and sized for each device, with no code changes.",
    );
    if (loadSiteConfig()?.config.optimizer === undefined) {
      logger.dim(
        "  Keep deploys in line with it: set sites.optimizer to true in bunny.jsonc",
      );
    }
  },
});
