import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { formatTable } from "../../core/format.ts";
import type { components } from "@bunny.net/api/generated/database.d.ts";
import { clientOptions } from "../../core/client-options.ts";

type Database = components["schemas"]["Database2"];
type DBLiveStatus = components["schemas"]["DBLiveStatus"];
type Region = components["schemas"]["Region"];

const COMMAND = "list";
const ALIASES = ["ls"] as const;
const DESCRIPTION = "List all databases.";

/**
 * List all databases associated with the current account.
 *
 * Results are sorted alphabetically by name and rendered as a table (ID, Name,
 * Status, Primary Region, Size).
 *
 * @example
 * ```bash
 * # List all databases
 * bunny db list
 *
 * # JSON output for scripting
 * bunny db list --output json
 * ```
 */
export const dbListCommand = defineCommand({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    const spin = spinner("Fetching databases...");
    spin.start();

    const allDatabases: Database[] = [];
    let page = 1;

    while (true) {
      const { data } = await client.GET("/v2/databases", {
        params: { query: { page, per_page: 100 } },
      });

      allDatabases.push(...(data?.databases ?? []));

      if (!data?.page_info?.has_more_items) break;
      page++;
    }

    // Fetch live status and region config in parallel
    let liveMetrics: Record<string, DBLiveStatus> = {};
    const regionNames = new Map<string, string>();

    if (allDatabases.length > 0) {
      const [liveRes, configRes] = await Promise.all([
        client.POST("/v1/live/live_db", {
          body: { db_ids: allDatabases.map((db) => db.id) },
        }),
        client.GET("/v1/config", { params: {} }),
      ]);
      liveMetrics = liveRes.data?.live_metrics ?? {};

      const allRegions: Region[] = [
        ...(configRes.data?.primary_regions ?? []),
        ...(configRes.data?.replica_regions ?? []),
      ];
      for (const r of allRegions) {
        regionNames.set(r.id, r.name);
      }
    }

    spin.stop();

    const databases = allDatabases.sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    if (output === "json") {
      logger.log(JSON.stringify(databases, null, 2));
      return;
    }

    if (databases.length === 0) {
      logger.info("No databases found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Status", "Primary Region", "Size"],
        databases.map((db) => {
          const live = liveMetrics[db.id];
          const status = live?.state === "Live" ? "Active" : "Idle";
          const regionCode =
            live?.state === "Live" ? live.metadata.main : null;
          const primary = regionCode
            ? regionNames.get(regionCode) ?? regionCode
            : "—";
          return [db.id, db.name, status, primary, db.current_size];
        }),
        output,
      ),
    );
  },
});
