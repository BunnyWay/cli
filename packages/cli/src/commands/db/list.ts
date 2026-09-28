import { createDbClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatBytes, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { spinner } from "@/core/ui.ts";
import {
  fetchAllDatabases,
  fetchLiveStatus,
  fetchRegionConfig,
  liveMainRegion,
  liveStatusLabel,
  regionNameMap,
} from "./api.ts";

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
  examples: [
    ["$0 db list", "List all databases"],
    ["$0 db list --output json", "JSON output for scripting"],
  ],
  describe: DESCRIPTION,

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createDbClient(clientOptions(config, verbose));

    const spin = spinner("Fetching databases...");
    spin.start();

    const allDatabases = await fetchAllDatabases(client);

    // Fetch live status and region config in parallel
    let liveMetrics: Awaited<ReturnType<typeof fetchLiveStatus>> = {};
    let regionNames = new Map<string, string>();

    if (allDatabases.length > 0) {
      const [live, config] = await Promise.all([
        fetchLiveStatus(
          client,
          allDatabases.map((db) => db.id),
        ),
        fetchRegionConfig(client),
      ]);
      liveMetrics = live;
      regionNames = regionNameMap(config);
    }

    spin.stop();

    const databases = allDatabases.sort((a, b) => a.name.localeCompare(b.name));

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
          const status = liveStatusLabel(live);
          const regionCode = liveMainRegion(live);
          const primary = regionCode
            ? (regionNames.get(regionCode) ?? regionCode)
            : "—";
          return [
            db.id,
            db.name,
            status,
            primary,
            formatBytes(db.current_size_bytes),
          ];
        }),
        output,
      ),
    );
  },
});
