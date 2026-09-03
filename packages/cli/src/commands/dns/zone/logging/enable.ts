import { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { resolveZoneInteractive } from "@/commands/dns/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { spinner } from "@/core/ui.ts";

type LogAnonymizationType = components["schemas"]["LogAnonymizationType"];
type LoggingUpdate = Pick<
  components["schemas"]["UpdateDnsZoneModel"],
  "LoggingEnabled" | "LoggingIPAnonymizationEnabled" | "LogAnonymizationType"
>;

interface EnableArgs {
  domain?: string;
  "anonymize-ip"?: boolean;
  anonymization?: string;
}

// LogAnonymizationType: 0 = OneDigit, 1 = Drop
const ANONYMIZATION: Record<string, LogAnonymizationType> = {
  onedigit: 0,
  drop: 1,
};

export const dnsZoneLoggingEnableCommand = defineCommand<EnableArgs>({
  command: "enable [domain]",
  describe: "Enable DNS query logging for a zone.",
  examples: [
    ["$0 dns zones logging enable example.com", "Start collecting query logs"],
    [
      "$0 dns zones logging enable example.com --anonymize-ip --anonymization drop",
      "Enable with IP anonymization",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .option("anonymize-ip", {
        type: "boolean",
        describe: "Anonymize client IPs in the logs",
      })
      .option("anonymization", {
        type: "string",
        choices: ["onedigit", "drop"],
        describe: "IP anonymization strategy (default: onedigit)",
      }),

  handler: async (args) => {
    const { domain, profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });

    const body: LoggingUpdate = { LoggingEnabled: true };

    if (args["anonymize-ip"] !== undefined) {
      body.LoggingIPAnonymizationEnabled = args["anonymize-ip"];
    }
    if (args.anonymization !== undefined) {
      const type = ANONYMIZATION[args.anonymization];
      if (type === undefined) {
        throw new UserError("Anonymization must be 'onedigit' or 'drop'.");
      }
      body.LogAnonymizationType = type;
      // Choosing a strategy implies enabling anonymization unless explicitly disabled.
      if (args["anonymize-ip"] === undefined) {
        body.LoggingIPAnonymizationEnabled = true;
      }
    }

    const spin = spinner("Enabling logging...");
    spin.start();
    let data: components["schemas"]["DnsZoneModel"] | undefined;
    try {
      ({ data } = await client.POST("/dnszone/{id}", {
        params: { path: { id: zone.Id as number } },
        body,
      }));
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(data, null, 2));
      return;
    }

    logger.success(`DNS query logging enabled for ${zone.Domain}.`);
    logger.dim("Logs start collecting now — allow a few minutes for data.");
  },
});
