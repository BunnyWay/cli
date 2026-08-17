import { dnsZonesDelete } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";

export const dnsZoneRemoveCommand = defineActionCommand({
  action: dnsZonesDelete,
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

  progress: "Deleting zone...",

  prepare: async ({ domain, force, output }, ctx) => {
    const zone = await resolveZoneInteractive(ctx.clients.core, domain, {
      output,
    });
    return {
      input: { zone: String(zone.Id) },
      confirm: () =>
        confirm(
          `Delete zone ${zone.Domain} and all ${(zone.Records ?? []).length} record(s)?`,
          { force },
        ),
    };
  },

  render: (result) => {
    logger.success(`Deleted DNS zone ${result.domain}.`);
  },
});
