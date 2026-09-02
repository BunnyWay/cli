import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveZoneInteractive } from "@/commands/dns/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, spinner } from "@/core/ui.ts";

interface ZoneRemoveArgs {
  domain?: string;
  force?: boolean;
}

export const dnsZoneRemoveCommand = defineCommand<ZoneRemoveArgs>({
  command: "remove [domain]",
  aliases: ["rm"],
  describe: "Delete a DNS zone and all of its records.",
  examples: [
    ["$0 dns zones remove example.com", "Delete a zone"],
    ["$0 dns zones remove example.com --force", "Skip confirmation"],
    ["$0 dns zones remove", "Pick a zone interactively"],
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

    const zone = await resolveZoneInteractive(client, domain, { output });

    const confirmed = await confirm(
      `Delete zone ${zone.Domain} and all ${(zone.Records ?? []).length} record(s)?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const removeSpin = spinner("Deleting zone...");
    removeSpin.start();
    try {
      await client.DELETE("/dnszone/{id}", {
        params: { path: { id: zone.Id as number } },
      });
    } finally {
      removeSpin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: zone.Id, domain: zone.Domain, removed: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Deleted DNS zone ${zone.Domain}.`);
  },
});
