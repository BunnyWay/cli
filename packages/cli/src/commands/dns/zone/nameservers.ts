import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveZoneInteractive } from "@/commands/dns/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import {
  checkDelegation,
  expectedNameservers,
} from "@/core/dns-nameservers.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { detectRegistrar } from "@/core/registrar.ts";

interface NameserversArgs {
  domain?: string;
}

export const dnsNameserversCommand = defineCommand<NameserversArgs>({
  command: "nameservers [domain]",
  aliases: ["ns"],
  describe: "Check whether a zone is delegated to bunny.net.",
  examples: [
    ["$0 dns zones nameservers example.com", "Check the zone's delegation"],
    ["$0 dns zones ns example.com --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional("domain", {
      type: "string",
      describe: "Domain or zone ID",
    }),

  handler: async ({ domain, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });
    const zoneDomain = zone.Domain ?? "";

    const custom =
      zone.CustomNameserversEnabled === true &&
      Boolean(zone.Nameserver1 || zone.Nameserver2);
    const nameservers = [...expectedNameservers(zone)];

    // Read the live registrar delegation; bunny's NameserversDetected flag defaults to true on a fresh zone.
    const { status, resolved } = await checkDelegation(zoneDomain, nameservers);
    const detected = status === "bunny";

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            domain: zoneDomain,
            custom,
            detected,
            status,
            resolved,
            nameservers,
          },
          null,
          2,
        ),
      );
      return;
    }

    // csv/table/markdown stay machine-readable; only plain text gets the prose guidance.
    if (output !== "text") {
      logger.log(
        formatKeyValue(
          [
            { key: "Domain", value: zoneDomain },
            { key: "Custom", value: custom ? "Yes" : "No" },
            { key: "Detected", value: detected ? "Yes" : "No" },
            { key: "Status", value: status },
            { key: "Resolved", value: resolved.join(" ") },
            { key: "Nameservers", value: nameservers.join(" ") },
          ],
          output,
        ),
      );
      return;
    }

    if (detected) {
      logger.success(
        `Nameservers detected and pointing to Bunny DNS for ${zoneDomain}.`,
      );
      return;
    }

    const registrar = await detectRegistrar(zoneDomain);
    logger.log(
      `Now update your nameservers at ${registrar ?? "your domain registrar"} to:`,
    );
    logger.log("");
    for (const ns of nameservers) logger.log(`  ${ns}`);
    logger.log("");
    logger.dim(
      `Propagation can take up to 48 hours. Verify with:\n  bunny dns zones ns ${zoneDomain}`,
    );
  },
});
