import { dbRegionsSet } from "@bunny.net/actions";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { actionContext } from "../../../core/action-context.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchDatabaseWithRegions, regionNameMap } from "../api.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { groupedRegionChoices } from "../region-choices.ts";
import { resolveDbId } from "../resolve-db.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];

const COMMAND = `add [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Add regions to a database.";

const ARG_PRIMARY = "primary";
const ARG_REPLICAS = "replicas";

interface AddArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_PRIMARY]?: string;
  [ARG_REPLICAS]?: string;
}

/**
 * Add primary or replica regions to a database.
 *
 * In interactive mode, shows available regions (excluding already configured
 * ones) grouped by continent.
 *
 * @example
 * ```bash
 * # Interactive — select regions to add
 * bunny db regions add
 *
 * # Add specific primary regions
 * bunny db regions add --primary FR,DE
 *
 * # Add replica regions
 * bunny db regions add --replicas UK,NY
 *
 * # Add both
 * bunny db regions add --primary FR --replicas UK
 * ```
 */
export const dbRegionsAddCommand = defineCommand<AddArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db regions add", "Interactive — select regions"],
    ["$0 db regions add --primary FR,DE", "Add primary regions"],
    ["$0 db regions add --primary FR --replicas UK", "Add both"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_PRIMARY, {
        type: "string",
        describe: "Comma-separated primary region IDs to add (e.g. FR,DE)",
      })
      .option(ARG_REPLICAS, {
        type: "string",
        describe: "Comma-separated replica region IDs to add (e.g. UK,NY)",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    primary: primaryArg,
    replicas: replicasArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    // Reads the current regions here, then hands the merged set to the set action.
    const ctx = actionContext(config, { verbose });
    const client = ctx.clients.db;

    const { id: databaseId } = await resolveDbId(client, databaseIdArg);

    const spin = spinner("Fetching database and regions...");
    spin.start();

    const { db, config: regionConfig } = await fetchDatabaseWithRegions(
      client,
      databaseId,
    );

    spin.stop();

    const availablePrimary = regionConfig.primary_regions;
    const availableReplicas = regionConfig.replica_regions;

    const currentPrimary = new Set(db.primary_regions);
    const currentReplicas = new Set(db.replicas_regions);

    let newPrimary: PossibleRegion[] = [];
    let newReplicas: PossibleRegion[] = [];

    if (primaryArg || replicasArg) {
      // Non-interactive path
      if (primaryArg) {
        newPrimary = primaryArg
          .split(",")
          .map((s) => s.trim()) as PossibleRegion[];
      }
      if (replicasArg) {
        newReplicas = replicasArg
          .split(",")
          .map((s) => s.trim()) as PossibleRegion[];
      }
    } else {
      // Interactive path — show only regions not already configured
      const unselectedPrimary = availablePrimary.filter(
        (r) => !currentPrimary.has(r.id),
      );
      const unselectedReplicas = availableReplicas.filter(
        (r) => !currentReplicas.has(r.id),
      );

      if (unselectedPrimary.length > 0) {
        const { value } = await prompts({
          type: "multiselect",
          name: "value",
          message: "Add primary regions:",
          choices: groupedRegionChoices(unselectedPrimary),
          hint: "Space to select, Enter to confirm (optional)",
        });
        newPrimary = value ?? [];
      }

      if (unselectedReplicas.length > 0) {
        const { value } = await prompts({
          type: "multiselect",
          name: "value",
          message: "Add replica regions:",
          choices: groupedRegionChoices(unselectedReplicas),
          hint: "Space to select, Enter to confirm (optional)",
        });
        newReplicas = value ?? [];
      }
    }

    if (newPrimary.length === 0 && newReplicas.length === 0) {
      logger.info("No regions to add.");
      return;
    }

    // Merge with existing regions and set the full result.
    const updateSpin = spinner("Updating regions...");
    updateSpin.start();
    let updated: Awaited<ReturnType<typeof dbRegionsSet.invoke>>;
    try {
      updated = await dbRegionsSet.invoke(ctx, {
        database: databaseId,
        primaryRegions: [...db.primary_regions, ...newPrimary],
        replicaRegions: [...db.replicas_regions, ...newReplicas],
      });
    } finally {
      updateSpin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            db_id: databaseId,
            primary_regions: updated.primary.map((r) => r.code),
            replicas_regions: updated.replica.map((r) => r.code),
          },
          null,
          2,
        ),
      );
      return;
    }

    const regionNames = regionNameMap(regionConfig);

    const added: string[][] = [];
    for (const id of newPrimary) {
      added.push(["Primary", regionNames.get(id) ?? id, id]);
    }
    for (const id of newReplicas) {
      added.push(["Replica", regionNames.get(id) ?? id, id]);
    }

    logger.success("Regions added.");
    logger.log();
    logger.log(formatTable(["Type", "Name", "ID"], added, output));
  },
});
