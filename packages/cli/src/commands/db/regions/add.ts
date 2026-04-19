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

    // Merge with existing regions
    const updatedPrimary = [...db.primary_regions, ...newPrimary];
    const updatedReplicas = [...db.replicas_regions, ...newReplicas];

    const updateSpin = spinner("Updating regions...");
    updateSpin.start();

    const { data: updated } = await client.PATCH("/v2/databases/{db_id}", {
      params: { path: { db_id: databaseId } },
      body: {
        primary_regions: updatedPrimary,
        replicas_regions: updatedReplicas,
      },
    });

    updateSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            db_id: databaseId,
            primary_regions: updated?.db?.primary_regions ?? updatedPrimary,
            replicas_regions: updated?.db?.replicas_regions ?? updatedReplicas,
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
