import { createCoreClient } from "@bunny.net/openapi-client";
import { type DnsZoneModel, fetchZones } from "@/commands/dns/api.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import {
  checkDelegations,
  type DelegationCheck,
  type DelegationStatus,
  expectedNameservers,
} from "@/core/dns-nameservers.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { spinner } from "@/core/ui.ts";

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
    let checks: DelegationCheck[] = [];
    if (zones.length > 0) {
      const checkSpin = spinner("Checking nameserver delegation...");
      checkSpin.start();
      try {
        checks = await checkDelegations(
          zones.map((z) => ({
            domain: z.Domain ?? "",
            expected: expectedNameservers(z),
          })),
        );
      } finally {
        checkSpin.stop();
      }
    }
    const delegation: DelegationStatus[] = checks.map((c) => c.status);

    if (output === "json") {
      const corrected = zones.map((z, i) => {
        const check = checks[i];
        return {
          ...z,
          // Trust the live result only when conclusive; on "unknown" keep the API flag so a transient resolver failure doesn't flip every zone to pending.
          NameserversDetected:
            check && check.status !== "unknown"
              ? check.status === "bunny"
              : z.NameserversDetected,
          NameserversDelegation: check?.status ?? "unknown",
          NameserversResolved: check?.resolved ?? [],
        };
      });
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
