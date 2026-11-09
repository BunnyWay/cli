import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { appsScale, SplitVolumeError } from "@/tools/apps/index.ts";
import { resolveAppId } from "./config.ts";

interface ScaleArgs {
  id?: string;
  min?: number;
  max?: number;
  "allow-split-volumes"?: boolean;
}

export const appsScaleCommand = defineToolCommand({
  tool: appsScale,
  command: "scale",
  describe: "Set the minimum and maximum instances for an app.",
  progress: "Updating scaling...",
  examples: [
    ["$0 apps scale --min 1 --max 3", "Run between 1 and 3 instances"],
    ["$0 apps scale --max 5", "Raise the maximum, keep the minimum"],
  ],

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (defaults to the linked app)",
      })
      .option("min", { type: "number", describe: "Minimum instances" })
      .option("max", { type: "number", describe: "Maximum instances" })
      .option("allow-split-volumes", {
        type: "boolean",
        describe: "Allow a volume to be split across regions or instances",
      }),

  prepare: async (args: ScaleArgs) => ({
    input: {
      app: resolveAppId(args.id),
      min: args.min,
      max: args.max,
      allowSplitVolumes: args["allow-split-volumes"],
    },
  }),

  onError: (error) =>
    error instanceof SplitVolumeError
      ? new UserError(
          error.message,
          "Volumes aren't shared: each region and each instance gets its own empty volume. Pass --allow-split-volumes if each copy should keep separate data.",
        )
      : undefined,

  render: (result, args) => {
    logger.success("Scaling updated.");
    logger.log(
      formatKeyValue(
        [
          { key: "Min", value: String(result.min) },
          { key: "Max", value: String(result.max) },
        ],
        args.output,
      ),
    );
  },
});
