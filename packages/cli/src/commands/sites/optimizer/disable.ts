import { pullZonesOptimizerSet } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { sitePositionalBuilder } from "../interactive.ts";
import { syncOptimizerConfig } from "./shared.ts";
import { resolveSitePullZone, type SitePullZone } from "./site.ts";

const sites = new WeakMap<object, SitePullZone>();

export const sitesOptimizerDisableCommand = defineToolCommand({
  tool: pullZonesOptimizerSet,
  command: "disable [site]",
  describe: "Turn off Bunny Optimizer and restore the site's cache settings.",
  examples: [["$0 sites optimizer disable", "Turn it off for the linked site"]],
  progress: "Turning off Bunny Optimizer...",

  builder: (yargs) => sitePositionalBuilder(yargs),

  prepare: async (args, ctx) => {
    const site = await resolveSitePullZone(ctx, args);
    sites.set(args, site);
    return { input: { pullZone: site.pullZone, enabled: false } };
  },

  after: (_, args) => syncOptimizerConfig(sites.get(args), false, args.output),

  render: (result, args) => {
    const name = sites.get(args)?.name ?? `pull zone ${result.pullZone}`;
    logger.success(
      result.changed
        ? `Bunny Optimizer is off for ${name}${result.purged ? " (cache purged)" : ""}.`
        : `Bunny Optimizer is already off for ${name}.`,
    );
  },
});
