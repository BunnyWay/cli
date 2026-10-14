import { createOptimizerCommands } from "@/core/optimizer/index.ts";
import { ARG_SITE_DESCRIPTION } from "../interactive.ts";
import { siteOptimizerTarget } from "./shared.ts";
import { resolveSitePullZone } from "./site.ts";

export const sitesOptimizerNamespace = createOptimizerCommands({
  commandPath: "sites optimizer",
  describe:
    "Serve a site's images as WebP sized for each device (Bunny Optimizer).",
  positional: { name: "site", describe: ARG_SITE_DESCRIPTION },
  resolve: async (site, args, ctx) =>
    siteOptimizerTarget(
      await resolveSitePullZone(ctx, { site, output: args.output }),
    ),
});
