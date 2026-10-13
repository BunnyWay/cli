import { createOptimizerCommands } from "@/core/optimizer/index.ts";
import { loadSiteConfig } from "../config.ts";
import { ARG_SITE_DESCRIPTION } from "../interactive.ts";
import { syncOptimizerConfig } from "./shared.ts";
import { resolveSitePullZone } from "./site.ts";

export const sitesOptimizerNamespace = createOptimizerCommands({
  commandPath: "sites optimizer",
  describe:
    "Serve a site's images as WebP sized for each device (Bunny Optimizer).",
  positional: { name: "site", describe: ARG_SITE_DESCRIPTION },
  label: "Site",
  resolve: (site, args, ctx) =>
    resolveSitePullZone(ctx, { site, output: args.output }),
  onChanged: syncOptimizerConfig,
  enableHint: () =>
    loadSiteConfig()?.config.optimizer === undefined
      ? "Keep deploys in line with it: set sites.optimizer to true in bunny.jsonc"
      : undefined,
});
