import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchStorageRegions, type StorageZoneModel } from "../api.ts";

interface ZoneAddArgs {
  name?: string;
  region?: string;
  replication?: string[];
}

export const storageZoneAddCommand = defineCommand<ZoneAddArgs>({
  command: "add [name]",
  describe: "Create a new storage zone.",
  examples: [
    ["$0 storage zones add", "Interactive: prompts for name and region"],
    [
      "$0 storage zones add my-zone --region DE",
      "Create a zone in Falkenstein",
    ],
    [
      "$0 storage zones add my-zone --region NY --replication LA,SG",
      "Create a zone with replication regions",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name for the new storage zone",
      })
      .option("region", {
        type: "string",
        describe: "Main storage region code (e.g. DE, NY, LA, SG)",
      })
      .option("replication", {
        type: "string",
        array: true,
        describe: "Replication region codes",
      }),

  handler: async ({
    name,
    region,
    replication,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // JSON output stays non-interactive; name and region must come from flags.
    const interactive = output !== "json";

    let zoneName = name;
    if (!zoneName && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Storage zone name:",
      });
      zoneName = value;
    }
    if (!zoneName) throw new UserError("A storage zone name is required.");

    // The main region cannot be changed after creation, so prompt for it too.
    let mainRegion = region;
    if (!mainRegion && interactive) {
      const regions = await fetchStorageRegions(client);
      if (regions.length === 0) {
        throw new UserError(
          "Could not load storage regions.",
          "Pass --region with a region code instead.",
        );
      }
      const { picked } = await prompts({
        type: "select",
        name: "picked",
        message: "Main region:",
        choices: regions.map((r) => ({
          title: `${r.Name ?? r.Id} (${r.Id})`,
          value: r.Id,
        })),
      });
      mainRegion = picked;
    }
    if (!mainRegion) {
      throw new UserError(
        "A region is required.",
        "Pass --region with a region code (e.g. DE, NY, LA, SG).",
      );
    }

    const spin = spinner("Creating storage zone...");
    spin.start();
    let created: StorageZoneModel | undefined;
    try {
      const { data } = await client.POST("/storagezone", {
        body: {
          Name: zoneName,
          Region: mainRegion,
          ReplicationRegions: replication ?? null,
        },
      });
      created = data;
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(created ?? { Name: zoneName }, null, 2));
      return;
    }

    logger.success(
      created?.Id
        ? `Created storage zone ${zoneName} (ID: ${created.Id}).`
        : `Created storage zone ${zoneName}.`,
    );
  },
});
