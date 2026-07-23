import { type DatabaseRegion, dbGet } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { formatBytes, formatKeyValue, progressBar } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { ARG_DATABASE_ID } from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

const COMMAND = `show [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Show database details.";

/** Format a region as "Name (CODE)". */
function formatRegion(region: DatabaseRegion): string {
  return region.name === region.code
    ? region.code
    : `${region.name} (${region.code})`;
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
export const dbShowCommand = defineActionCommand({
  action: dbGet,
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db show", "Auto-detect database from .env"],
    ["$0 db show db_01KCHBG8C5KSFGG0VRNFQ7EK7X", "Show a specific database"],
    ["$0 db show --output json", "JSON output for scripting"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_DATABASE_ID, {
      type: "string",
      describe: "Database ID (defaults to the linked or .env database)",
    }),

  progress: "Fetching database...",

  prepare: async (args, ctx) => {
    const { id } = await resolveDbId(ctx.clients.db, args[ARG_DATABASE_ID]);
    return { input: { database: id } };
  },

  render: (db, { output }) => {
    const sizeFraction =
      db.maxSizeBytes > 0 ? db.sizeBytes / db.maxSizeBytes : 0;
    const sizePercent = Math.round(sizeFraction * 100);
    const currentSize = formatBytes(db.sizeBytes);
    const maxSize = formatBytes(db.maxSizeBytes);

    const entries = [
      { key: "ID", value: db.id },
      { key: "Name", value: db.name },
      { key: "URL", value: db.url },
      { key: "Status", value: db.status === "active" ? "Active" : "Idle" },
      {
        key: "Size",
        value:
          output === "text"
            ? `${currentSize} / ${maxSize}  ${progressBar(sizeFraction)}  ${sizePercent}%`
            : `${currentSize} / ${maxSize} (${sizePercent}%)`,
      },
      { key: "Storage Region", value: db.storageRegion },
      {
        key: "Primary Region",
        value: db.primaryRegion ? formatRegion(db.primaryRegion) : "—",
      },
      {
        key: "Replica Regions",
        value:
          db.replicaRegions.length > 0
            ? db.replicaRegions.map(formatRegion).join(", ")
            : "None",
      },
    ];

    logger.log(formatKeyValue(entries, output));
  },
});
