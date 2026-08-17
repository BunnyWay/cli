import { dnsRecordsDelete } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm } from "../../../core/ui.ts";
import {
  resolveRecordInteractive,
  resolveZoneInteractive,
} from "../interactive.ts";
import {
  formatRecordValue,
  recordName,
  recordTypeLabel,
} from "../record-types.ts";

export const dnsRemoveCommand = defineActionCommand({
  action: dnsRecordsDelete,
  command: "remove [domain] [id]",
  aliases: ["rm"],
  describe: "Remove a DNS record from a zone (prompts when args are omitted).",
  examples: [
    ["$0 dns records remove example.com 123", "Remove a record by ID"],
    ["$0 dns records remove example.com 123 --force", "Skip confirmation"],
    ["$0 dns records remove", "Pick a zone and record interactively"],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .positional("id", { type: "number", describe: "Record ID" })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  progress: "Removing record...",

  prepare: async ({ domain, id, force, output }, ctx) => {
    const zone = await resolveZoneInteractive(ctx.clients.core, domain, {
      output,
      offerLink: true,
    });
    const record = await resolveRecordInteractive(zone, id, "remove", output);

    const label = `${recordTypeLabel(record.Type)} ${recordName(record.Name)} → ${formatRecordValue(record)}`;
    return {
      input: { zone: String(zone.Id), record: record.Id as number },
      confirm: () => confirm(`Remove ${label}?`, { force }),
    };
  },

  render: (result) => {
    logger.success(`Removed record ${result.id} from ${result.domain}.`);
  },
});
