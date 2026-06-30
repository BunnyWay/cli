import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import {
  checkDelegations,
  type DelegationStatus,
  expectedNameservers,
} from "../../../core/dns-nameservers.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { type DnsZoneModel, fetchZones } from "../api.ts";

const DELEGATION_LABEL: Record<DelegationStatus, string> = {
  bunny: "Detected",
  other: "Pending",
  unknown: "Unknown",
};

export const dnsZoneListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List all DNS zones.",
  examples: [
    ["$0 dns zones list", "List all DNS zones"],
    ["$0 dns zones list --output json", "JSON output"],
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

    // bunny's NameserversDetected defaults to true on a fresh zone; resolve the real delegation live.
    let delegation: DelegationStatus[] = [];
    if (zones.length > 0) {
      const checkSpin = spinner("Checking nameserver delegation...");
      checkSpin.start();
      try {
        const checks = await checkDelegations(
          zones.map((z) => ({
            domain: z.Domain ?? "",
            expected: expectedNameservers(z),
          })),
        );
        delegation = checks.map((c) => c.status);
      } finally {
        checkSpin.stop();
      }
    }

    if (output === "json") {
      // Overwrite the unreliable API flag with the live result so scripts read the true value.
      const corrected = zones.map((z, i) => ({
        ...z,
        NameserversDetected: delegation[i] === "bunny",
      }));
      logger.log(JSON.stringify(corrected, null, 2));
      return;
    }

    if (zones.length === 0) {
      logger.info("No DNS zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Domain", "Records", "DNSSEC", "Nameservers"],
        zones.map((z, i) => [
          String(z.Id ?? ""),
          z.Domain ?? "",
          String((z.Records ?? []).length),
          z.DnsSecEnabled ? "Yes" : "No",
          DELEGATION_LABEL[delegation[i] ?? "unknown"],
        ]),
        output,
      ),
    );
  },
});
