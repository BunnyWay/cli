import { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { resolveConfig } from "../../../../config/index.ts";
import { clientOptions } from "../../../../core/client-options.ts";
import { defineCommand } from "../../../../core/define-command.ts";
import { formatKeyValue } from "../../../../core/format.ts";
import { logger } from "../../../../core/logger.ts";
import { spinner } from "../../../../core/ui.ts";
import { resolveZoneInteractive } from "../../interactive.ts";

interface EnableArgs {
  domain?: string;
}

export const dnsZoneDnssecEnableCommand = defineCommand<EnableArgs>({
  command: "enable [domain]",
  describe: "Enable DNSSEC for a zone and print its DS record.",
  examples: [["$0 dns zone dnssec enable example.com", "Enable DNSSEC"]],

  builder: (yargs) =>
    yargs.positional("domain", {
      type: "string",
      describe: "Domain or zone ID",
    }),

  handler: async ({ domain, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);

    const spin = spinner("Enabling DNSSEC...");
    spin.start();
    let data: components["schemas"]["DnsSecDsRecordModel"] | undefined;
    try {
      ({ data } = await client.POST("/dnszone/{id}/dnssec", {
        params: { path: { id: zone.Id as number } },
      }));
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(data, null, 2));
      return;
    }

    logger.success(`DNSSEC enabled for ${zone.Domain}.`);
    if (data?.DsRecord) {
      logger.log(
        formatKeyValue(
          [
            { key: "DS Record", value: data.DsRecord ?? "" },
            { key: "Digest", value: data.Digest ?? "" },
            { key: "Digest Type", value: data.DigestType ?? "" },
            { key: "Algorithm", value: String(data.Algorithm ?? "") },
            { key: "Key Tag", value: String(data.KeyTag ?? "") },
            { key: "Flags", value: String(data.Flags ?? "") },
            { key: "Public Key", value: data.PublicKey ?? "" },
          ],
          output,
        ),
      );
    }
    logger.dim(
      "Add the DS record above at your domain registrar to complete DNSSEC setup.",
    );
  },
});
