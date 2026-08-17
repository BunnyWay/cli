import { type DelegationStatus, dnsZonesList } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";

const DELEGATION_LABEL: Record<DelegationStatus, string> = {
  bunny: "Detected",
  other: "Pending",
  unknown: "Unknown",
};

export const dnsZoneListCommand = defineActionCommand({
  action: dnsZonesList,
  command: "list",
  aliases: ["ls"],
  describe: "List all DNS zones.",
  examples: [
    ["$0 dns zones list", "List all DNS zones"],
    ["$0 dns zones list --output json", "JSON output"],
  ],

  progress: "Fetching DNS zones...",

  // bunny's NameserversDetected defaults to true on a fresh zone; resolve the real delegation live.
  prepare: async () => ({ input: { checkDelegation: true } }),

  render: (zones, { output }) => {
    if (zones.length === 0) {
      logger.info("No DNS zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Domain", "Records", "DNSSEC", "Nameservers"],
        zones.map((zone) => [
          String(zone.id),
          zone.domain,
          String(zone.recordCount),
          zone.dnssecEnabled ? "Yes" : "No",
          DELEGATION_LABEL[zone.delegation?.status ?? "unknown"],
        ]),
        output,
      ),
    );
  },
});
