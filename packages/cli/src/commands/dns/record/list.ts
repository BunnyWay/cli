import { dnsRecordsList } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveZoneInteractive } from "../interactive.ts";

/** Render a normalized record's value with its type-specific fields inline. */
function recordValue(record: {
  type: string;
  value: string;
  priority?: number;
  weight?: number;
  port?: number;
  flags?: number;
  tag?: string;
}): string {
  switch (record.type) {
    case "MX":
      return `${record.priority ?? 0} ${record.value}`;
    case "SRV":
      return `${record.priority ?? 0} ${record.weight ?? 0} ${record.port ?? 0} ${record.value}`;
    case "CAA":
      return `${record.flags ?? 0} ${record.tag ?? ""} "${record.value}"`;
    default:
      return record.value;
  }
}

export const dnsRecordListCommand = defineActionCommand({
  action: dnsRecordsList,
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

  progress: "Fetching records...",

  prepare: async ({ domain, output }, ctx) => {
    const zone = await resolveZoneInteractive(ctx.clients.core, domain, {
      output,
      offerLink: true,
    });
    return { input: { zone: String(zone.Id) } };
  },

  render: (records, { output }) => {
    if (records.length === 0) {
      logger.info("No records found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Type", "Value", "TTL"],
        records.map((r) => [
          String(r.id),
          r.name,
          r.type,
          recordValue(r),
          r.ttl != null ? String(r.ttl) : "",
        ]),
        output,
      ),
    );
  },
});
