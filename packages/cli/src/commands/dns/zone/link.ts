import { createCoreClient } from "@bunny.net/openapi-client";
import { DNS_MANIFEST } from "@/commands/dns/constants.ts";
import { resolveZoneInteractive } from "@/commands/dns/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { saveManifest } from "@/core/manifest.ts";

interface LinkArgs {
  domain?: string;
}

export const dnsZoneLinkCommand = defineCommand<LinkArgs>({
  command: "link [domain]",
  describe: `Link this directory to a DNS zone (writes .bunny/${DNS_MANIFEST}).`,
  examples: [
    ["$0 dns zones link example.com", "Link by domain or zone ID"],
    ["$0 dns zones link", "Pick a zone interactively"],
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
      ignoreManifest: true,
    });

    saveManifest(DNS_MANIFEST, {
      id: zone.Id,
      domain: zone.Domain ?? undefined,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: zone.Id, domain: zone.Domain }));
      return;
    }

    logger.success(`Linked to ${zone.Domain} (${zone.Id}).`);
  },
});
