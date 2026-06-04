import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../../config/index.ts";
import { clientOptions } from "../../../../core/client-options.ts";
import { defineCommand } from "../../../../core/define-command.ts";
import { logger } from "../../../../core/logger.ts";
import { confirm, spinner } from "../../../../core/ui.ts";
import { resolveZoneInteractive } from "../../interactive.ts";

interface DisableArgs {
  domain?: string;
  force?: boolean;
}

export const dnsZoneDnssecDisableCommand = defineCommand<DisableArgs>({
  command: "disable [domain]",
  describe: "Disable DNSSEC for a zone.",
  examples: [
    ["$0 dns zone dnssec disable example.com", "Disable DNSSEC"],
    ["$0 dns zone dnssec disable example.com --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async ({ domain, force, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);

    const confirmed = await confirm(`Disable DNSSEC for ${zone.Domain}?`, {
      force,
    });
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const disableSpin = spinner("Disabling DNSSEC...");
    disableSpin.start();
    await client.DELETE("/dnszone/{id}/dnssec", {
      params: { path: { id: zone.Id as number } },
    });
    disableSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: zone.Id, domain: zone.Domain, dnssec: false },
          null,
          2,
        ),
      );
      return;
    }

    logger.warn(
      `DNSSEC disabled for ${zone.Domain}. Remove the DS record at your registrar.`,
    );
  },
});
