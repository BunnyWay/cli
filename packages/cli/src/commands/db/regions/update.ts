import { dbRegionsSet } from "@bunny.net/actions";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { actionContext } from "../../../core/action-context.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchDatabaseWithRegions, regionNameMap } from "../api.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { groupedRegionChoices } from "../region-choices.ts";
import { resolveDbId } from "../resolve-db.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];

const COMMAND = `update [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Update region configuration.";

const ARG_PRIMARY = "primary";
const ARG_REPLICAS = "replicas";

interface UpdateArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_PRIMARY]?: string;
  [ARG_REPLICAS]?: string;
}

/**
 * Interactively update the primary and replica regions for a database.
 *
 * Shows all available regions grouped by continent, with currently configured
 * regions pre-selected. Toggle regions on/off and confirm to apply changes.
 *
 * @example
 * ```bash
 * # Interactive — prompts for region selection
 * bunny db regions update
 *
 * # Non-interactive with explicit regions
 * bunny db regions update --primary FR,DE --replicas UK
 * ```
 */
export const dbRegionsUpdateCommand = defineCommand<UpdateArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db regions update", "Interactive — prompts for region selection"],
    ["$0 db regions update --primary FR,DE --replicas UK", "Non-interactive"],
  ],

  builder: (yargs) =>
    yargs
      .option(ARG_PRIMARY, {
        type: "string",
        describe: "Comma-separated primary region IDs (e.g. FR or FR,DE)",
      })
      .option(ARG_REPLICAS, {
        type: "string",
        describe: "Comma-separated replica region IDs (e.g. UK,NY)",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    [ARG_PRIMARY]: primaryArg,
    [ARG_REPLICAS]: replicasArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    // Reads the current regions here, then hands the replacement set to the set action.
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

    let newPrimary: PossibleRegion[];
    let newReplicas: PossibleRegion[];

    if (primaryArg) {
      // Non-interactive path: flags provided
      newPrimary = primaryArg
        .split(",")
        .map((s) => s.trim()) as PossibleRegion[];
      newReplicas = replicasArg
        ? (replicasArg.split(",").map((s) => s.trim()) as PossibleRegion[])
        : [...currentReplicas];
    } else {
      // Interactive path: multi-select with current regions pre-selected
      const { value: selectedPrimary } = await prompts({
        type: "multiselect",
        name: "value",
        message: "Primary regions:",
        choices: groupedRegionChoices(availablePrimary, currentPrimary),
        hint: "Space to toggle, Enter to confirm",
      });

      if (!selectedPrimary) {
        throw new UserError("Cancelled.");
      }

      newPrimary = selectedPrimary as PossibleRegion[];

      const { value: selectedReplicas } = await prompts({
        type: "multiselect",
        name: "value",
        message: "Replica regions:",
        choices: groupedRegionChoices(availableReplicas, currentReplicas),
        hint: "Space to toggle, Enter to confirm (optional)",
      });

      if (!selectedReplicas) {
        throw new UserError("Cancelled.");
      }

      newReplicas = selectedReplicas as PossibleRegion[];
    }

    if (newPrimary.length === 0) {
      throw new UserError(
        "Cannot remove all primary regions.",
        "At least one primary region is required.",
      );
    }

    // Check if anything actually changed
    const primarySame =
      newPrimary.length === currentPrimary.size &&
      newPrimary.every((id) => currentPrimary.has(id));
    const replicasSame =
      newReplicas.length === currentReplicas.size &&
      newReplicas.every((id) => currentReplicas.has(id));

    if (primarySame && replicasSame) {
      logger.info("No changes.");
      return;
    }

    const updateSpin = spinner("Updating regions...");
    updateSpin.start();
    let updated: Awaited<ReturnType<typeof dbRegionsSet.invoke>>;
    try {
      updated = await dbRegionsSet.invoke(ctx, {
        database: databaseId,
        primaryRegions: newPrimary,
        replicaRegions: newReplicas,
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

    // Build region name lookup
    const regionNames = regionNameMap(regionConfig);

    const rows: string[][] = [];
    for (const id of newPrimary) {
      rows.push(["Primary", regionNames.get(id) ?? id, id]);
    }
    for (const id of newReplicas) {
      rows.push(["Replica", regionNames.get(id) ?? id, id]);
    }

    logger.success("Regions updated.");
    logger.log();
    logger.log(formatTable(["Type", "Name", "ID"], rows, output));
  },
});
