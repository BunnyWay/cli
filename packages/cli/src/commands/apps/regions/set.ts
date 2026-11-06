import { resolveAppId } from "@/commands/apps/config.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { appsRegionsSet } from "@/tools/apps/index.ts";

interface SetArgs {
  regions: string[];
  required?: string[];
  id?: string;
  "allow-split-volumes"?: boolean;
}

export const appsRegionsSetCommand = defineToolCommand({
  tool: appsRegionsSet,
  command: "set <regions..>",
  describe: "Set the regions an app runs in.",
  progress: "Updating regions...",
  examples: [
    ["$0 apps regions set DE UK", "Always run in DE and UK"],
    [
      "$0 apps regions set DE UK NY --required DE",
      "Allow three regions, always run in DE",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("regions", {
        type: "string",
        array: true,
        describe: "Allowed region IDs (see `bunny apps regions list`)",
        demandOption: true,
      })
      .option("required", {
        type: "string",
        array: true,
        describe: "Regions that must always run (defaults to all allowed)",
      })
      .option("allow-split-volumes", {
        type: "boolean",
        describe: "Allow a volume to be split across regions or instances",
      })
      .option("id", {
        type: "string",
        describe: "App ID (defaults to the linked app)",
      }),

  prepare: async (args: SetArgs) => ({
    input: {
      app: resolveAppId(args.id),
      regions: args.regions.map(String),
      required: args.required?.map(String),
      allowSplitVolumes: args["allow-split-volumes"],
    },
  }),

  render: (result, args) => {
    logger.success("Regions updated.");
    logger.log(
      formatKeyValue(
        [
          {
            key: "Allowed Regions",
            value: result.allowedRegionIds?.join(", ") || "None",
          },
          {
            key: "Required Regions",
            value: result.requiredRegionIds?.join(", ") || "None",
          },
        ],
        args.output,
      ),
    );
  },
});
