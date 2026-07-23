import { dbList } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { formatBytes, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";

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
export const dbListCommand = defineActionCommand({
  action: dbList,
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 db list", "List all databases"],
    ["$0 db list --output json", "JSON output for scripting"],
  ],

  progress: "Fetching databases...",

  prepare: async () => ({ input: {} }),

  render: (databases, { output }) => {
    if (databases.length === 0) {
      logger.info("No databases found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Status", "Primary Region", "Size"],
        databases.map((db) => [
          db.id,
          db.name,
          db.status === "active" ? "Active" : "Idle",
          db.primaryRegion?.name ?? "—",
          formatBytes(db.sizeBytes),
        ]),
        output,
      ),
    );
  },
});
