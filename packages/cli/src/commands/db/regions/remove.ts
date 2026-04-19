import { createDbClient } from "@bunny.net/api";
import type { components } from "@bunny.net/api/generated/database.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { resolveDbId } from "../resolve-db.ts";

type Region = components["schemas"]["Region"];

const COMMAND = `remove [${ARG_DATABASE_ID}]`;
const ALIASES = ["rm"] as const;
const DESCRIPTION = "Remove regions from a database.";

const ARG_PRIMARY = "primary";
const ARG_REPLICAS = "replicas";
const ARG_FORCE = "force";

interface RemoveArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_PRIMARY]?: string;
  [ARG_REPLICAS]?: string;
  [ARG_FORCE]?: boolean;
}

/**
 * Remove primary or replica regions from a database.
 *
 * In interactive mode, shows currently configured regions and lets you select
 * which to remove.
 *
 * @example
 * ```bash
 * # Interactive — select regions to remove
 * bunny db regions remove
 *
 * # Remove specific primary regions
 * bunny db regions remove --primary FR,DE
 *
 * # Remove replica regions
 * bunny db regions remove --replicas UK
 *
 * # Skip confirmation prompt
 * bunny db regions remove --primary FR --force
 * ```
 */
export const dbRegionsRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  aliases: ALIASES,
  examples: [
    ["$0 db regions remove", "Interactive — select regions to remove"],
    ["$0 db regions remove --primary FR,DE", "Remove specific primary regions"],
    ["$0 db regions remove --replicas UK", "Remove replica regions"],
    ["$0 db regions remove --primary FR --force", "Skip confirmation prompt"],
  ],
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_PRIMARY, {
        type: "string",
        describe: "Comma-separated primary region IDs to remove (e.g. FR,DE)",
      })
      .option(ARG_REPLICAS, {
        type: "string",
        describe: "Comma-separated replica region IDs to remove (e.g. UK)",
      })
      .option(ARG_FORCE, {
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    primary: primaryArg,
    replicas: replicasArg,
    force,
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

    // Build region name lookup
    const regionNames = new Map<string, string>();
    const allRegions: Region[] = [
      ...(configResult.data?.primary_regions ?? []),
      ...(configResult.data?.replica_regions ?? []),
    ];
    for (const r of allRegions) {
      regionNames.set(r.id, r.name);
    }

    let removePrimary: Set<string>;
    let removeReplicas: Set<string>;

    if (primaryArg || replicasArg) {
      // Non-interactive path
      removePrimary = new Set(
        primaryArg ? primaryArg.split(",").map((s) => s.trim()) : [],
      );
      removeReplicas = new Set(
        replicasArg ? replicasArg.split(",").map((s) => s.trim()) : [],
      );
    } else {
      // Interactive path — select from current regions
      removePrimary = new Set<string>();
      removeReplicas = new Set<string>();

      if (db.primary_regions.length > 0) {
        const { value } = await prompts({
          type: "multiselect",
          name: "value",
          message: "Remove primary regions:",
          choices: db.primary_regions.map((id) => ({
            title: `${regionNames.get(id) ?? id} (${id})`,
            value: id,
          })),
          hint: "Space to select, Enter to confirm (optional)",
        });
        for (const id of value ?? []) {
          removePrimary.add(id);
        }
      }

      if (db.replicas_regions.length > 0) {
        const { value } = await prompts({
          type: "multiselect",
          name: "value",
          message: "Remove replica regions:",
          choices: db.replicas_regions.map((id) => ({
            title: `${regionNames.get(id) ?? id} (${id})`,
            value: id,
          })),
          hint: "Space to select, Enter to confirm (optional)",
        });
        for (const id of value ?? []) {
          removeReplicas.add(id);
        }
      }
    }

    if (removePrimary.size === 0 && removeReplicas.size === 0) {
      logger.info("No regions to remove.");
      return;
    }

    const updatedPrimary = db.primary_regions.filter(
      (id) => !removePrimary.has(id),
    );
    const updatedReplicas = db.replicas_regions.filter(
      (id) => !removeReplicas.has(id),
    );

    if (updatedPrimary.length === 0) {
      throw new UserError(
        "Cannot remove all primary regions.",
        "At least one primary region is required.",
      );
    }

    if (db.replicas_regions.length > 0 && updatedReplicas.length === 0) {
      logger.warn("This will remove all read replicas from your database.");
    }

    const parts: string[] = [];
    if (removePrimary.size > 0) {
      const names = [...removePrimary]
        .map((id) => regionNames.get(id) ?? id)
        .join(", ");
      parts.push(`primary: ${names}`);
    }
    if (removeReplicas.size > 0) {
      const names = [...removeReplicas]
        .map((id) => regionNames.get(id) ?? id)
        .join(", ");
      parts.push(`replica: ${names}`);
    }

    const confirmed = await confirm(
      `Remove regions from "${db.name}" (${parts.join("; ")})?`,
      { force },
    );
    if (!confirmed) {
      logger.info("Aborted.");
      return;
    }

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

    const removed: string[][] = [];
    for (const id of removePrimary) {
      removed.push(["Primary", regionNames.get(id) ?? id, id]);
    }
    for (const id of removeReplicas) {
      removed.push(["Replica", regionNames.get(id) ?? id, id]);
    }

    logger.success("Regions removed.");
    logger.log();
    logger.log(formatTable(["Type", "Name", "ID"], removed, output));
  },
});
