import {
  linkedPullZoneSource,
  resolvePullZoneTarget,
} from "@/commands/pz/target.ts";
import { sitePullZoneSource } from "@/commands/sites/optimizer/shared.ts";
import { createOptimizerCommands } from "@/core/optimizer/index.ts";

// Resources whose directory links lead to a pull zone; the first linked one wins.
const sources = [linkedPullZoneSource, sitePullZoneSource];

export const optimizerNamespace = createOptimizerCommands({
  commandPath: "optimizer",
  describe:
    "Serve images as WebP sized for each device on any pull zone (Bunny Optimizer).",
  positional: {
    name: "pull-zone",
    describe:
      "Pull zone ID or name (uses the linked pull zone or site if omitted)",
  },
  resolve: (ref, args, ctx) =>
    resolvePullZoneTarget(ctx, ref, args.output, sources),
});
