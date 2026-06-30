import { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import { discoverImportableRecords } from "./scan-records.ts";
import { reviewAndApply } from "./write.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];

interface ScanArgs {
  domain?: string;
  yes?: boolean;
}

export const dnsScanCommand = defineCommand<ScanArgs>({
  command: "scan [domain]",
  describe: "Scan for a domain's existing DNS records and import them.",
  examples: [
    ["$0 dns records scan example.com", "Discover and import existing records"],
    ["$0 dns records scan example.com --yes", "Import without confirming"],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .option("yes", {
        type: "boolean",
        alias: "y",
        describe: "Skip the import confirmation",
      }),

  handler: async ({ domain, yes, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });

    const spin =
      output === "text"
        ? spinner("Scanning for existing DNS records...")
        : null;
    spin?.start();
    let records: AddDnsRecordModel[];
    try {
      records = await discoverImportableRecords(client, zone);
    } finally {
      spin?.stop();
    }

    if (records.length === 0) {
      if (output === "json") {
        logger.log(JSON.stringify({ applied: [], failures: [] }, null, 2));
        return;
      }
      logger.info(`No new records discovered for ${zone.Domain}.`);
      return;
    }

    await reviewAndApply({
      client,
      zone,
      records,
      output,
      selectMessage: `Found ${records.length} existing record(s) for ${zone.Domain}. Select which to import:`,
      spinnerLabel: "Importing records...",
      successFor: (n) => `Imported ${n} record(s) into ${zone.Domain}.`,
      assumeYes: yes,
    });
  },
});
