import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { fetchZones, resolveZone } from "./api.ts";
import {
  formatRecordValue,
  recordName,
  recordTypeLabel,
} from "./record-types.ts";

interface ListArgs {
  domain?: string;
}

export const dnsListCommand = defineCommand<ListArgs>({
  command: "list [domain]",
  aliases: ["ls"],
  describe: "List DNS zones, or the records within a zone.",
  examples: [
    ["$0 dns list", "List all DNS zones"],
    ["$0 dns list example.com", "List records in a zone"],
    ["$0 dns list example.com --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional("domain", {
      type: "string",
      describe: "Domain or zone ID (omit to list all zones)",
    }),

  handler: async ({ domain, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    if (domain) {
      const spin = spinner("Fetching DNS records...");
      spin.start();
      const zone = await resolveZone(client, domain);
      spin.stop();

      const records = (zone.Records ?? []).sort((a, b) =>
        recordName(a.Name).localeCompare(recordName(b.Name)),
      );

      if (output === "json") {
        logger.log(JSON.stringify(zone, null, 2));
        return;
      }

      if (records.length === 0) {
        logger.info(`No records found in ${zone.Domain}.`);
        return;
      }

      logger.log(
        formatTable(
          ["ID", "Name", "Type", "Value", "TTL"],
          records.map((r) => [
            String(r.Id ?? ""),
            recordName(r.Name),
            recordTypeLabel(r.Type),
            formatRecordValue(r),
            String(r.Ttl ?? ""),
          ]),
          output,
        ),
      );
      return;
    }

    const spin = spinner("Fetching DNS zones...");
    spin.start();
    const zones = await fetchZones(client);
    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(zones, null, 2));
      return;
    }

    if (zones.length === 0) {
      logger.info("No DNS zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Domain", "Records", "DNSSEC", "Nameservers"],
        zones.map((z) => [
          String(z.Id ?? ""),
          z.Domain ?? "",
          String((z.Records ?? []).length),
          z.DnsSecEnabled ? "Yes" : "No",
          z.NameserversDetected ? "Detected" : "Pending",
        ]),
        output,
      ),
    );
  },
});
