import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveZoneInteractive } from "../interactive.ts";

interface NameserversArgs {
  domain?: string;
}

// bunny.net delegates every zone to the same two anycast nameservers.
const BUNNY_DEFAULT_NAMESERVERS = ["kiki.bunny.net", "coco.bunny.net"];

export const dnsNameserversCommand = defineCommand<NameserversArgs>({
  command: "nameservers [domain]",
  aliases: ["ns"],
  describe: "Show the nameservers to set at your registrar for a zone.",
  examples: [
    ["$0 dns zone nameservers example.com", "Show the zone's nameservers"],
    ["$0 dns zone ns example.com --output json", "JSON output"],
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

    const custom =
      zone.CustomNameserversEnabled === true &&
      Boolean(zone.Nameserver1 || zone.Nameserver2);
    const nameservers = custom
      ? [zone.Nameserver1, zone.Nameserver2].filter((ns): ns is string =>
          Boolean(ns),
        )
      : BUNNY_DEFAULT_NAMESERVERS;
    const detected = zone.NameserversDetected === true;

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { domain: zone.Domain, custom, detected, nameservers },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "Zone", value: zone.Domain ?? "" },
          { key: "Type", value: custom ? "Custom" : "Default (bunny.net)" },
          { key: "Detected at registrar", value: detected ? "Yes" : "No" },
        ],
        output,
      ),
    );

    logger.log("");
    logger.log(
      formatTable(
        ["Nameserver"],
        nameservers.map((ns) => [ns]),
        output,
      ),
    );

    if (!detected) {
      logger.log("");
      logger.dim(
        `Point ${zone.Domain}'s nameservers at the above to delegate it to bunny.net.`,
      );
    }
  },
});
