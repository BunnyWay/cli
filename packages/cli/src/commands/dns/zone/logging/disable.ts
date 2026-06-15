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

export const dnsZoneLoggingDisableCommand = defineCommand<DisableArgs>({
  command: "disable [domain]",
  describe: "Disable DNS query logging for a zone.",
  examples: [
    ["$0 dns zones logging disable example.com", "Stop collecting query logs"],
    ["$0 dns zones logging disable example.com --force", "Skip confirmation"],
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

    const confirmed = await confirm(
      `Disable DNS query logging for ${zone.Domain}?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const disableSpin = spinner("Disabling logging...");
    disableSpin.start();
    const { data } = await client.POST("/dnszone/{id}", {
      params: { path: { id: zone.Id as number } },
      body: { LoggingEnabled: false },
    });
    disableSpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(data, null, 2));
      return;
    }

    logger.success(`DNS query logging disabled for ${zone.Domain}.`);
  },
});
