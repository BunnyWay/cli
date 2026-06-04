import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";
import {
  resolveRecordInteractive,
  resolveZoneInteractive,
} from "./interactive.ts";
import {
  formatRecordValue,
  recordName,
  recordTypeLabel,
} from "./record-types.ts";

interface RemoveArgs {
  domain?: string;
  id?: number;
  force?: boolean;
}

export const dnsRemoveCommand = defineCommand<RemoveArgs>({
  command: "remove [domain] [id]",
  aliases: ["rm"],
  describe: "Remove a DNS record from a zone (prompts when args are omitted).",
  examples: [
    ["$0 dns remove example.com 123", "Remove a record by ID"],
    ["$0 dns remove example.com 123 --force", "Skip confirmation"],
    ["$0 dns remove", "Pick a zone and record interactively"],
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

  handler: async ({ domain, id, force, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);
    const record = await resolveRecordInteractive(zone, id, "remove");

    const label = `${recordTypeLabel(record.Type)} ${recordName(record.Name)} → ${formatRecordValue(record)}`;
    const confirmed = await confirm(`Remove ${label}?`, { force });
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const removeSpin = spinner("Removing record...");
    removeSpin.start();
    await client.DELETE("/dnszone/{zoneId}/records/{id}", {
      params: { path: { zoneId: zone.Id as number, id: record.Id as number } },
    });
    removeSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { zoneId: zone.Id, id: record.Id, removed: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Removed record ${record.Id} from ${zone.Domain}.`);
  },
});
