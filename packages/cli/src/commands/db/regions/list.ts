import { dbRegionsList } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { resolveDbId } from "../resolve-db.ts";

const COMMAND = `list [${ARG_DATABASE_ID}]`;
const ALIASES = ["ls"] as const;
const DESCRIPTION = "List configured regions for a database.";

/**
 * List the configured primary and replica regions for a database.
 *
 * @example
 * ```bash
 * bunny db regions list
 * bunny db regions list db_01KCHBG8C5KSFGG0VRNFQ7EK7X
 * bunny db regions list --output json
 * ```
 */
export const dbRegionsListCommand = defineActionCommand({
  action: dbRegionsList,
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 db regions list", "List regions for auto-detected database"],
    ["$0 db regions list --output json", "JSON output for scripting"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_DATABASE_ID, {
      type: "string",
      describe: "Database ID (defaults to the linked or .env database)",
    }),

  progress: "Fetching regions...",

  prepare: async (args, ctx) => {
    const { id } = await resolveDbId(ctx.clients.db, args[ARG_DATABASE_ID]);
    return { input: { database: id } };
  },

  render: (regions, { output }) => {
    const rows = [
      ...regions.primary.map((r) => ["Primary", r.name, r.code]),
      ...regions.replica.map((r) => ["Replica", r.name, r.code]),
    ];

    if (rows.length === 0) {
      logger.info("No regions configured.");
      return;
    }

    logger.log(formatTable(["Type", "Name", "ID"], rows, output));
  },
});
