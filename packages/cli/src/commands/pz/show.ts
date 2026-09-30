import { type PullZone, pullZonesGet } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { resolvePullZoneId } from "./constants.ts";

export function statusLabel(status: PullZone["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export const pzShowCommand = defineToolCommand({
  tool: pullZonesGet,
  command: "show [id]",
  describe: "Show pull zone details.",
  examples: [
    ["$0 pz show", "Show selected pull zone"],
    ["$0 pz show 12345", "Show pull zone 12345"],
  ],
  progress: "Fetching pull zone...",

  builder: (yargs) =>
    yargs.positional("id", {
      type: "number",
      describe: "Pull zone ID (uses selected one if omitted)",
    }),

  prepare: async ({ id }) => ({ input: { pullZone: resolvePullZoneId(id) } }),

  render: (zone, { output }) => {
    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(zone.id) },
          { key: "Name", value: zone.name },
          { key: "Origin", value: zone.originUrl ?? "" },
          { key: "Status", value: statusLabel(zone.status) },
          { key: "Hostnames", value: zone.hostnames.join(", ") || "none" },
          { key: "Storage Zone ID", value: String(zone.storageZoneId ?? "") },
          { key: "Edge Script ID", value: String(zone.edgeScriptId ?? "") },
          {
            key: "Security",
            value: zone.zoneSecurity ? "Enabled" : "Disabled",
          },
        ],
        output,
      ),
    );
  },
});
