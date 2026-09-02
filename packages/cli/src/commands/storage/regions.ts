import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import {
  mainRegionChoices,
  regionTierNote,
  replicationChoices,
  STORAGE_REGIONS,
  ZONE_TIER_CHOICES,
  type ZoneTierChoice,
} from "./constants.ts";

interface RegionsArgs {
  tier?: ZoneTierChoice;
  s3?: boolean;
}

export const storageRegionsCommand = defineCommand<RegionsArgs>({
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

  handler: async ({ tier, s3, output }) => {
    const scoped = tier !== undefined || s3 !== undefined;
    const scope = { tier, s3 };
    const main = new Set(mainRegionChoices(scope).map((r) => r.code));
    const replica = new Set(
      replicationChoices(undefined, scope).map((r) => r.code),
    );
    const regions = scoped
      ? STORAGE_REGIONS.filter((r) => main.has(r.code) || replica.has(r.code))
      : STORAGE_REGIONS;

    if (output === "json") {
      logger.log(
        JSON.stringify(
          regions.map((region) => ({
            ...region,
            main: main.has(region.code),
            replication: replica.has(region.code),
          })),
          null,
          2,
        ),
      );
      return;
    }

    logger.log(
      formatTable(
        ["Code", "Name", "Main", "Replication", "Notes"],
        regions.map((region) => [
          region.code,
          region.name,
          main.has(region.code) ? "yes" : "no",
          replica.has(region.code) ? "yes" : "no",
          regionTierNote(region.code),
        ]),
        output,
      ),
    );
    if (!scoped) {
      logger.dim(
        "Edge (SSD) zones add six replication-only regions; S3 zones drop Sao Paulo (BR).",
      );
      logger.dim("Scope the list with --tier hdd|ssd and --s3.");
    }
  },
});
