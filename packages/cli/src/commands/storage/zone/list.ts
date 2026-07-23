import { storageZonesList } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatBytes, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";

export const storageZoneListCommand = defineActionCommand({
  action: storageZonesList,
  command: "list",
  aliases: ["ls"],
  describe: "List all storage zones.",
  examples: [
    ["$0 storage zones list", "List all storage zones"],
    ["$0 storage zones list --search assets", "Filter zones by name"],
    ["$0 storage zones list --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.option("search", {
      type: "string",
      describe: "Only list zones whose name matches this term",
    }),

  progress: "Fetching storage zones...",

  prepare: async ({ search }) => ({ input: { search } }),

  render: (zones, { output }) => {
    if (zones.length === 0) {
      logger.info("No storage zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Region", "Files", "Used"],
        zones.map((zone) => [
          String(zone.id),
          zone.name,
          zone.region,
          String(zone.filesStored),
          formatBytes(zone.storageUsed),
        ]),
        output,
      ),
    );
  },
});
