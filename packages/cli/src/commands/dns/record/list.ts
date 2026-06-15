import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import {
  formatRecordValue,
  recordName,
  recordTypeLabel,
} from "../record-types.ts";

interface ListArgs {
  domain?: string;
}

export const dnsRecordListCommand = defineCommand<ListArgs>({
  command: "list [domain]",
  aliases: ["ls"],
  describe: "List the records within a zone.",
  examples: [
    ["$0 dns records list example.com", "List records in a zone"],
    ["$0 dns records list example.com --output json", "JSON output"],
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

    const records = (zone.Records ?? []).sort((a, b) =>
      recordName(a.Name).localeCompare(recordName(b.Name)),
    );

    if (output === "json") {
      logger.log(JSON.stringify(records, null, 2));
      return;
    }

    if (records.length === 0) {
      logger.info(`No records found in ${zone.Domain}.`);
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Type", "Value", "TTL"],
        records.map((r) => [
          String(r.Id ?? ""),
          recordName(r.Name),
          recordTypeLabel(r.Type),
          formatRecordValue(r),
          String(r.Ttl ?? ""),
        ]),
        output,
      ),
    );
  },
});
