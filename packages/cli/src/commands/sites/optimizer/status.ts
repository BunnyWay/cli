import { pullZonesOptimizerGet } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { sitePositionalBuilder } from "../interactive.ts";
import { formatPrice, renderOptimizerStatus } from "./shared.ts";
import { resolveSitePullZone } from "./site.ts";

const siteNames = new WeakMap<object, string>();

export const sitesOptimizerStatusCommand = defineToolCommand({
  tool: pullZonesOptimizerGet,
  command: "status [site]",
  describe: "Show whether Bunny Optimizer is on for a site.",
  examples: [
    ["$0 sites optimizer status", "Status for the linked site"],
    ["$0 sites optimizer status my-site --output json", "As JSON"],
  ],
  progress: "Fetching Optimizer status...",

  builder: (yargs) => sitePositionalBuilder(yargs),

  prepare: async (args, ctx) => {
    const site = await resolveSitePullZone(ctx, args);
    siteNames.set(args, site.name);
    return { input: { pullZone: site.pullZone } };
  },

  render: (status, args) => {
    renderOptimizerStatus(siteNames.get(args) ?? "", status, args.output);
    logger.log();
    if (!status.enabled) {
      logger.dim(
        `  Turn it on (${formatPrice(status.monthlyPrice)}): bunny sites optimizer enable`,
      );
    } else if (!status.configured) {
      logger.dim(
        "  Some settings differ from what sites expect; re-apply them: bunny sites optimizer enable",
      );
    }
  },
});
