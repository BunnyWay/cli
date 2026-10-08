import { defineNamespace } from "@/core/define-namespace.ts";
import { sitesOptimizerDisableCommand } from "./disable.ts";
import { sitesOptimizerEnableCommand } from "./enable.ts";
import { sitesOptimizerStatusCommand } from "./status.ts";

export const sitesOptimizerNamespace = defineNamespace(
  "optimizer",
  "Serve a site's images as WebP sized for each device (Bunny Optimizer).",
  [
    sitesOptimizerStatusCommand,
    sitesOptimizerEnableCommand,
    sitesOptimizerDisableCommand,
  ],
);
