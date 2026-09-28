import { pullZonesList } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { statusLabel } from "./show.ts";

export const pzListCommand = defineToolCommand({
  tool: pullZonesList,
  command: "list",
  aliases: ["ls"],
  describe: "List all pull zones.",
  examples: [
    ["$0 pz list", "List all pull zones"],
    ["$0 pz list --output json", "JSON output"],
  ],
  progress: "Fetching pull zones...",

  prepare: async () => ({ input: {} }),

  render: (zones, { output }) => {
    if (zones.length === 0) {
      logger.info("No pull zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Origin", "Status"],
        zones.map((zone) => [
          String(zone.id),
          zone.name,
          zone.originUrl ?? "",
          statusLabel(zone.status),
        ]),
        output,
      ),
    );
  },
});
