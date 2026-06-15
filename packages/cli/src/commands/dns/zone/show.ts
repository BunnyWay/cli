import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatDateTime, formatKeyValue } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveZoneInteractive } from "../interactive.ts";

interface ShowArgs {
  domain?: string;
}

export const dnsZoneShowCommand = defineCommand<ShowArgs>({
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

  handler: async ({ domain, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);

    if (output === "json") {
      logger.log(JSON.stringify(zone, null, 2));
      return;
    }

    const nameservers = zone.CustomNameserversEnabled
      ? [zone.Nameserver1, zone.Nameserver2].filter(Boolean).join(", ")
      : "bunny.net (default)";

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(zone.Id ?? "") },
          { key: "Domain", value: zone.Domain ?? "" },
          { key: "Records", value: String((zone.Records ?? []).length) },
          {
            key: "Nameservers",
            value: zone.NameserversDetected ? "Detected" : "Pending",
          },
          { key: "Nameserver config", value: nameservers },
          { key: "SOA email", value: zone.SoaEmail ?? "—" },
          { key: "DNSSEC", value: zone.DnsSecEnabled ? "Enabled" : "Disabled" },
          {
            key: "Logging",
            value: zone.LoggingEnabled ? "Enabled" : "Disabled",
          },
          { key: "Created", value: formatDateTime(zone.DateCreated) },
          { key: "Modified", value: formatDateTime(zone.DateModified) },
        ],
        output,
      ),
    );
  },
});
