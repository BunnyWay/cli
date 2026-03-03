import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import type { components } from "@bunny.net/api/generated/database.d.ts";
import { clientOptions } from "../../core/client-options.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];
type Region = components["schemas"]["Region"];

const COMMAND = "create";
const DESCRIPTION = "Create a new database.";

const GROUP_LABELS: Record<string, string> = {
  EU: "Europe",
  NA: "North America",
  SA: "South America",
  AF: "Africa",
  ASIA: "Asia",
  OC: "Oceania",
};

const GROUP_ORDER = ["EU", "NA", "SA", "AF", "ASIA", "OC"];

/** Build prompt choices grouped by continent. */
function groupedRegionChoices(regions: Region[]) {
  const byGroup = new Map<string, Region[]>();
  for (const r of regions) {
    const group = r.group ?? "Other";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(r);
  }

  const choices: { title: string; value: PossibleRegion | null; disabled?: boolean }[] = [];
  for (const group of GROUP_ORDER) {
    const groupRegions = byGroup.get(group);
    if (!groupRegions || groupRegions.length === 0) continue;
    choices.push({
      title: `── ${GROUP_LABELS[group] ?? group} ──`,
      value: null as unknown as PossibleRegion,
      disabled: true,
    });
    for (const r of groupRegions) {
      choices.push({ title: `${r.name} (${r.id})`, value: r.id });
    }
  }

  return choices;
}

const ARG_NAME = "name";
const ARG_PRIMARY = "primary";
const ARG_REPLICAS = "replicas";
const ARG_STORAGE_REGION = "storage-region";

interface CreateArgs {
  [ARG_NAME]?: string;
  [ARG_PRIMARY]?: string;
  [ARG_REPLICAS]?: string;
  [ARG_STORAGE_REGION]?: string;
}

/**
 * Create a new database with configurable region placement.
 *
 * Supports three region selection modes:
 * - **Automatic** — regions chosen based on location and performance needs
 * - **Single region** — deploy to one region with no replication
 * - **Manual** — multi-select primary and replica regions
 *
 * When flags (`--name`, `--primary`) are provided the command runs
 * non-interactively; otherwise it prompts for each value.
 *
 * @example
 * ```bash
 * # Interactive — prompts for name and regions
 * bunny db create
 *
 * # Non-interactive with explicit regions
 * bunny db create --name my-app --primary FR,DE --replicas UK
 *
 * # JSON output for scripting
 * bunny db create --name my-app --primary FR --output json
 * ```
 */
export const dbCreateCommand = defineCommand<CreateArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option(ARG_NAME, {
        type: "string",
        describe: "Database name",
      })
      .option(ARG_PRIMARY, {
        type: "string",
        describe: "Comma-separated primary region IDs (e.g. FR or FR,DE)",
      })
      .option(ARG_REPLICAS, {
        type: "string",
        describe: "Comma-separated replica region IDs (e.g. UK,NY)",
      })
      .option(ARG_STORAGE_REGION, {
        type: "string",
        describe: "Override auto-detected storage region",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    // Step 1: Database name
    let name = args.name;
    if (!name) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Database name:",
      });
      name = value;
    }
    if (!name) throw new UserError("Database name is required.");

    // Fetch available regions from config
    const configSpin = spinner("Fetching available regions...");
    configSpin.start();

    const { data: regionConfig } = await client.GET("/v1/config", {
      params: {},
    });

    configSpin.stop();

    if (!regionConfig) {
      throw new UserError("Could not fetch region configuration.");
    }

    const storageRegions = regionConfig.storage_region_available;
    const availablePrimary = regionConfig.primary_regions;
    const availableReplicas = regionConfig.replica_regions;

    let primaryRegions: PossibleRegion[];
    let replicasRegions: PossibleRegion[];

    // Non-interactive path: flags provided
    if (args.primary) {
      primaryRegions = args.primary.split(",").map((s) => s.trim()) as PossibleRegion[];
      replicasRegions = args.replicas
        ? (args.replicas.split(",").map((s) => s.trim()) as PossibleRegion[])
        : [];
    } else {
      // Interactive path: ask about region mode
      const { value: regionMode } = await prompts({
        type: "select",
        name: "value",
        message: "Region selection:",
        choices: [
          {
            title: "Automatic",
            description:
              "Regions selected based on your location and performance needs",
            value: "automatic" as const,
          },
          {
            title: "Single region",
            description: "Deploy to a single region with no replication",
            value: "single" as const,
          },
          {
            title: "Manual",
            description: "Select primary and replication regions",
            value: "manual" as const,
          },
        ],
      });
      if (!regionMode) throw new UserError("Region selection is required.");

      if (regionMode === "automatic") {
        primaryRegions = availablePrimary.slice(0, 3).map((r) => r.id);
        replicasRegions = availableReplicas.slice(0, 3).map((r) => r.id);
      } else if (regionMode === "single") {
        const { value: location } = await prompts({
          type: "select",
          name: "value",
          message: "Database location:",
          choices: groupedRegionChoices(availablePrimary),
        });
        if (!location) throw new UserError("Location is required.");

        primaryRegions = [location];
        replicasRegions = [];
      } else {
        // Manual: multi-select primary and replicas
        const { value: selectedPrimary } = await prompts({
          type: "multiselect",
          name: "value",
          message: "Primary regions:",
          choices: groupedRegionChoices(availablePrimary),
          hint: "Space to select, Enter to confirm",
        });
        primaryRegions = selectedPrimary ?? [];

        if (primaryRegions.length === 0) {
          throw new UserError("At least one primary region is required.");
        }

        const { value: selectedReplicas } = await prompts({
          type: "multiselect",
          name: "value",
          message: "Replication regions:",
          choices: groupedRegionChoices(availableReplicas),
          hint: "Space to select, Enter to confirm (optional)",
        });
        replicasRegions = selectedReplicas ?? [];
      }
    }

    // Resolve storage region: explicit override, or auto-detect from first primary
    let storageRegion = args["storage-region"];
    if (!storageRegion) {
      const firstPrimary = availablePrimary.find(
        (r) => r.id === primaryRegions[0],
      );
      const matchingStorage = storageRegions.find(
        (s) => s.group === firstPrimary?.group,
      );
      storageRegion = matchingStorage?.id ?? storageRegions[0]?.id ?? "";
    }

    // Create database
    const createSpin = spinner("Creating database...");
    createSpin.start();

    const { data } = await client.POST("/v2/databases", {
      body: {
        name,
        storage_region: storageRegion,
        primary_regions: primaryRegions,
        replicas_regions: replicasRegions,
      },
    });

    if (!data?.db_id) {
      createSpin.stop();
      throw new UserError("Failed to create database.");
    }

    // Fetch full database details to get the URL
    createSpin.text = "Fetching database details...";

    const { data: dbDetails } = await client.GET("/v2/databases/{db_id}", {
      params: { path: { db_id: data.db_id } },
    });

    createSpin.stop();

    const db = dbDetails?.db;

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            db_id: data.db_id,
            name: db?.name ?? name,
            url: db?.url ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    const entries = [
      { key: "ID", value: data.db_id },
      { key: "Name", value: db?.name ?? name ?? "" },
    ];
    if (db?.url) {
      entries.push({ key: "URL", value: db.url });
    }

    logger.success(`Database created.`);
    logger.log();
    logger.log(formatKeyValue(entries, output));
  },
});
