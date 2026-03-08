import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { resolveDbId } from "./resolve-db.ts";
import { spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue, parseSizeToBytes, progressBar } from "../../core/format.ts";
import type { components } from "@bunny.net/api/generated/database.d.ts";
import { ARG_DATABASE_ID } from "./constants.ts";
import { clientOptions } from "../../core/client-options.ts";

type Region = components["schemas"]["Region"];

const COMMAND = `show [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Show database details.";

interface ShowArgs {
  [ARG_DATABASE_ID]?: string;
}

/**
 * Display details for a single database.
 *
 * Shows the database name, URL, region configuration, size, and status.
 *
 * @example
 * ```bash
 * # Show database details (auto-detected from .env)
 * bunny db show
 *
 * # Show a specific database
 * bunny db show db_01KCHBG8C5KSFGG0VRNFQ7EK7X
 *
 * # JSON output for scripting
 * bunny db show --output json
 * ```
 */
export const dbShowCommand = defineCommand<ShowArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    const { id: databaseId } = await resolveDbId(client, databaseIdArg);

    const spin = spinner("Fetching database...");
    spin.start();

    const [dbResult, liveResult, configResult] = await Promise.all([
      client.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      }),
      client.POST("/v1/live/live_db", {
        body: { db_ids: [databaseId] },
      }),
      client.GET("/v1/config", { params: {} }),
    ]);

    spin.stop();

    const db = dbResult.data?.db;
    if (!db) throw new UserError(`Database ${databaseId} not found.`);

    const live = liveResult.data?.live_metrics?.[databaseId];

    const regionNames = new Map<string, string>();
    const allRegions: Region[] = [
      ...(configResult.data?.primary_regions ?? []),
      ...(configResult.data?.replica_regions ?? []),
    ];
    for (const r of allRegions) {
      regionNames.set(r.id, r.name);
    }

    /** Format a region code as "Name (CODE)". */
    const formatRegion = (code: string) => {
      const name = regionNames.get(code);
      return name ? `${name} (${code})` : code;
    };

    if (output === "json") {
      logger.log(JSON.stringify({ ...db, live_status: live ?? null }, null, 2));
      return;
    }

    const status = live?.state === "Live" ? "Active" : "Idle";
    const primaryRegion =
      live?.state === "Live" ? formatRegion(live.metadata.main) : "—";
    const replicaRegions =
      live?.state === "Live" && live.metadata.replicas.length > 0
        ? live.metadata.replicas.map(formatRegion).join(", ")
        : "None";

    const sizeBytes = parseSizeToBytes(db.current_size);
    const maxBytes = parseSizeToBytes(db.size_max);
    const sizeFraction = maxBytes > 0 ? sizeBytes / maxBytes : 0;
    const sizePercent = Math.round(sizeFraction * 100);
    const sizePlain = `${db.current_size} / ${db.size_max} (${sizePercent}%)`;

    const entries = [
      { key: "ID", value: db.id },
      { key: "Name", value: db.name },
      { key: "URL", value: db.url },
      { key: "Status", value: status },
      {
        key: "Size",
        value: output === "text"
          ? `${db.current_size} / ${db.size_max}  ${progressBar(sizeFraction)}  ${sizePercent}%`
          : sizePlain,
      },
      { key: "Storage Region", value: db.storage_region },
      { key: "Primary Region", value: primaryRegion },
      { key: "Replica Regions", value: replicaRegions },
    ];

    logger.log(formatKeyValue(entries, output));
  },
});
