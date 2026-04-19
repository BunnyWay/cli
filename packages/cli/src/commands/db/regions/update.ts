import { createDbClient } from "@bunny.net/api";
import type { components } from "@bunny.net/api/generated/database.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { groupedRegionChoices } from "../region-choices.ts";
import { resolveDbId } from "../resolve-db.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];
type Region = components["schemas"]["Region"];

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
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    const { id: databaseId } = await resolveDbId(client, databaseIdArg);

    const spin = spinner("Fetching database and regions...");
    spin.start();

    const [dbResult, configResult] = await Promise.all([
      client.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      }),
      client.GET("/v1/config", { params: {} }),
    ]);

    spin.stop();

    const db = dbResult.data?.db;
    if (!db) throw new UserError(`Database ${databaseId} not found.`);

    const regionConfig = configResult.data;
    if (!regionConfig) {
      throw new UserError("Could not fetch region configuration.");
    }

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
        logger.log("Cancelled.");
        return;
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
        logger.log("Cancelled.");
        return;
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

    const { data: updated } = await client.PATCH("/v2/databases/{db_id}", {
      params: { path: { db_id: databaseId } },
      body: {
        primary_regions: newPrimary,
        replicas_regions: newReplicas,
      },
    });

    updateSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            db_id: databaseId,
            primary_regions: updated?.db?.primary_regions ?? newPrimary,
            replicas_regions: updated?.db?.replicas_regions ?? newReplicas,
          },
          null,
          2,
        ),
      );
      return;
    }

    // Build region name lookup
    const regionNames = new Map<string, string>();
    const allRegions: Region[] = [...availablePrimary, ...availableReplicas];
    for (const r of allRegions) {
      regionNames.set(r.id, r.name);
    }

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
