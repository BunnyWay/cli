import { createDbClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatBytes, formatKeyValue, progressBar } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  fetchDatabase,
  fetchLiveStatus,
  fetchRegionConfig,
  liveMainRegion,
  liveStatusLabel,
  regionNameMap,
} from "./api.ts";
import { ARG_DATABASE_ID } from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

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
  examples: [
    ["$0 db show", "Auto-detect database from .env"],
    ["$0 db show db_01KCHBG8C5KSFGG0VRNFQ7EK7X", "Show a specific database"],
    ["$0 db show --output json", "JSON output for scripting"],
  ],

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createDbClient(clientOptions(config, verbose));

    const { id: databaseId } = await resolveDbId(client, databaseIdArg);

    const spin = spinner("Fetching database...");
    spin.start();

    const [db, liveMetrics, regionConfig] = await Promise.all([
      fetchDatabase(client, databaseId),
      fetchLiveStatus(client, [databaseId]),
      fetchRegionConfig(client),
    ]);

    spin.stop();

    const live = liveMetrics[databaseId];
    const regionNames = regionNameMap(regionConfig);

    /** Format a region code as "Name (CODE)". */
    const formatRegion = (code: string) => {
      const name = regionNames.get(code);
      return name ? `${name} (${code})` : code;
    };

    if (output === "json") {
      logger.log(JSON.stringify({ ...db, live_status: live ?? null }, null, 2));
      return;
    }

    const status = liveStatusLabel(live);
    const mainCode = liveMainRegion(live);
    const primaryRegion = mainCode ? formatRegion(mainCode) : "—";
    const replicaRegions =
      live?.state === "Live" && live.metadata.replicas.length > 0
        ? live.metadata.replicas.map(formatRegion).join(", ")
        : "None";

    const sizeBytes = db.current_size_bytes;
    const maxBytes = db.size_max_bytes;
    const sizeFraction = maxBytes > 0 ? sizeBytes / maxBytes : 0;
    const sizePercent = Math.round(sizeFraction * 100);
    const currentSize = formatBytes(sizeBytes);
    const maxSize = formatBytes(maxBytes);
    const sizePlain = `${currentSize} / ${maxSize} (${sizePercent}%)`;

    const entries = [
      { key: "ID", value: db.id },
      { key: "Name", value: db.name },
      { key: "URL", value: db.url },
      { key: "Status", value: status },
      {
        key: "Size",
        value:
          output === "text"
            ? `${currentSize} / ${maxSize}  ${progressBar(sizeFraction)}  ${sizePercent}%`
            : sizePlain,
      },
      { key: "Storage Region", value: db.storage_region },
      { key: "Primary Region", value: primaryRegion },
      { key: "Replica Regions", value: replicaRegions },
    ];

    logger.log(formatKeyValue(entries, output));
  },
});
