import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import {
  type StorageRegionOption,
  storageRegionsList,
} from "@/tools/storage/index.ts";
import {
  mainRegionChoices,
  ZONE_TIER_CHOICES,
  type ZoneTierChoice,
} from "./constants.ts";

interface RegionsArgs {
  tier?: ZoneTierChoice;
  s3?: boolean;
}

// One row per region and tier, since a region's roles and S3 support differ between tiers.
function regionRows(catalog: StorageRegionOption[], { tier, s3 }: RegionsArgs) {
  const tiers = tier ? [tier] : ZONE_TIER_CHOICES;
  return tiers
    .flatMap((rowTier) => {
      const mains = mainRegionChoices(catalog, { tier: rowTier, s3 }).map(
        (region) => region.code,
      );
      return catalog
        .filter((region) => region.tier === rowTier && (!s3 || region.s3))
        .map((region) => ({
          code: region.code,
          name: region.name,
          tier: rowTier,
          main: region.main,
          replication: mains.some((code) => code !== region.code),
          s3: region.s3,
        }));
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export const storageRegionsCommand = defineToolCommand({
  tool: storageRegionsList,
  command: "regions",
  describe: "List available storage regions.",
  examples: [
    ["$0 storage regions", "List every storage region"],
    [
      "$0 storage regions --tier ssd",
      "List regions an Edge (SSD) zone can use",
    ],
    ["$0 storage regions --tier hdd --s3", "List regions an S3 zone can use"],
  ],
  progress: "Fetching storage regions...",

  builder: (yargs) =>
    yargs
      .option("tier", {
        choices: ZONE_TIER_CHOICES,
        describe: "Only show regions available to this zone tier",
      })
      .option("s3", {
        type: "boolean",
        describe: "Only show regions available to S3-compatible zones",
      }),

  prepare: async () => ({ input: {} }),

  json: (catalog, args) => regionRows(catalog, args),

  render: (catalog, args) => {
    logger.log(
      formatTable(
        ["Code", "Name", "Tier", "Main", "Replication", "S3"],
        regionRows(catalog, args).map((region) => [
          region.code,
          region.name,
          region.tier.toUpperCase(),
          region.main ? "yes" : "no",
          region.replication ? "yes" : "no",
          region.s3 ? "yes" : "no",
        ]),
        args.output,
      ),
    );
    if (args.tier === undefined && args.s3 === undefined) {
      logger.dim("Scope the list with --tier hdd|ssd and --s3.");
    }
  },
});
