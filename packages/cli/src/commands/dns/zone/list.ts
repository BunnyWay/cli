import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { type DnsZoneModel, fetchZones } from "../api.ts";

export const dnsZoneListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List all DNS zones.",
  examples: [
    ["$0 dns zone list", "List all DNS zones"],
    ["$0 dns zone list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Fetching DNS zones...");
    spin.start();
    let zones: DnsZoneModel[];
    try {
      zones = await fetchZones(client);
    } finally {
      spin.stop();
    }

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
