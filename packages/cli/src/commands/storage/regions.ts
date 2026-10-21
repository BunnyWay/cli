import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import {
  type StorageRegionOption,
  storageRegionsList,
} from "@/tools/storage/index.ts";
import {
  mainRegionChoices,
  regionTierNote,
  replicationChoices,
  storageRegions,
  ZONE_TIER_CHOICES,
  type ZoneTierChoice,
} from "./constants.ts";

interface RegionsArgs {
  tier?: ZoneTierChoice;
  s3?: boolean;
}

function regionRows(catalog: StorageRegionOption[], { tier, s3 }: RegionsArgs) {
  const scope = { tier, s3 };
  const main = new Set(mainRegionChoices(catalog, scope).map((r) => r.code));
  const replica = new Set(
    replicationChoices(catalog, undefined, scope).map((r) => r.code),
  );
  const scoped = tier !== undefined || s3 !== undefined;

  return storageRegions(catalog)
    .filter((r) => !scoped || main.has(r.code) || replica.has(r.code))
    .map((region) => ({
      ...region,
      main: main.has(region.code),
      replication: replica.has(region.code),
    }));
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
        ["Code", "Name", "Main", "Replication", "Notes"],
        regionRows(catalog, args).map((region) => [
          region.code,
          region.name,
          region.main ? "yes" : "no",
          region.replication ? "yes" : "no",
          regionTierNote(catalog, region.code),
        ]),
        args.output,
      ),
    );
    if (args.tier === undefined && args.s3 === undefined) {
      logger.dim("Scope the list with --tier hdd|ssd and --s3.");
    }
  },
});
