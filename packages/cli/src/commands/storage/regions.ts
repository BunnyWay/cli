import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import {
  type StorageRegionOption,
  storageRegionsList,
} from "@/tools/storage/index.ts";
import {
  mainRegionChoices,
  replicationChoices,
  storageRegions,
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

// One row per region with the original main/replication fields, plus the per-tier rows under `tiers`.
function jsonRows(catalog: StorageRegionOption[], args: RegionsArgs) {
  const scope = { tier: args.tier, s3: args.s3 };
  const main = new Set(mainRegionChoices(catalog, scope).map((r) => r.code));
  const replica = new Set(
    replicationChoices(catalog, undefined, scope).map((r) => r.code),
  );
  const scoped = args.tier !== undefined || args.s3 !== undefined;
  const rows = regionRows(catalog, args);

  return storageRegions(catalog)
    .filter((r) => !scoped || main.has(r.code) || replica.has(r.code))
    .map((region) => ({
      ...region,
      main: main.has(region.code),
      replication: replica.has(region.code),
      tiers: rows
        .filter((row) => row.code === region.code)
        .map(({ tier, main, replication, s3 }) => ({
          tier,
          main,
          replication,
          s3,
        })),
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

  json: (catalog, args) => jsonRows(catalog, args),

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
