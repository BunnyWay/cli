import { dnsZonesGet } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatDateTime, formatKeyValue } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveZoneInteractive } from "../interactive.ts";

export const dnsZoneShowCommand = defineActionCommand({
  action: dnsZonesGet,
  command: "show [domain]",
  describe: "Show details for a DNS zone.",
  examples: [
    ["$0 dns zones show example.com", "Show zone details"],
    ["$0 dns zones show example.com --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional("domain", {
      type: "string",
      describe: "Domain or zone ID",
    }),

  progress: "Fetching zone...",

  prepare: async ({ domain, output }, ctx) => {
    const zone = await resolveZoneInteractive(ctx.clients.core, domain, {
      output,
      offerLink: true,
    });
    return { input: { zone: String(zone.Id) } };
  },

  render: (zone, { output }) => {
    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(zone.id) },
          { key: "Domain", value: zone.domain },
          { key: "Records", value: String(zone.records.length) },
          {
            key: "Nameservers",
            value: zone.nameserversDetected ? "Detected" : "Pending",
          },
          { key: "Nameserver config", value: zone.nameservers.join(", ") },
          { key: "SOA email", value: zone.soaEmail ?? "-" },
          { key: "DNSSEC", value: zone.dnssecEnabled ? "Enabled" : "Disabled" },
          {
            key: "Logging",
            value: zone.loggingEnabled ? "Enabled" : "Disabled",
          },
          { key: "Created", value: formatDateTime(zone.dateCreated) },
          { key: "Modified", value: formatDateTime(zone.dateModified) },
        ],
        output,
      ),
    );
  },
});
