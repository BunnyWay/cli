import { storageZonesGet } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
} from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

export const storageZoneShowCommand = defineActionCommand({
  action: storageZonesGet,
  command: "show [zone]",
  describe: "Show details for a storage zone.",
  examples: [
    ["$0 storage zones show my-zone", "Show zone details"],
    ["$0 storage zones show my-zone --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional("zone", {
      type: "string",
      describe: "Storage zone name or ID",
    }),

  progress: "Fetching storage zone...",

  prepare: async ({ zone: ref, output }, ctx) => {
    const zone = await resolveStorageZoneInteractive(ctx.clients.core, ref, {
      output,
      offerLink: true,
    });
    return { input: { zone: String(zone.Id) } };
  },

  render: (zone, { output }) => {
    const rows = [
      { key: "ID", value: String(zone.id) },
      { key: "Name", value: zone.name },
      { key: "Region", value: zone.region || "-" },
      { key: "Replication", value: zone.replicationRegions.join(", ") || "-" },
      { key: "Hostname", value: zone.hostname ?? "-" },
      { key: "Files", value: String(zone.filesStored) },
      { key: "Used", value: formatBytes(zone.storageUsed) },
      {
        key: "Modified",
        value: formatDateTime(zone.dateModified ?? undefined),
      },
    ];

    if (zone.s3.enabled) {
      rows.push(
        { key: "S3 compatible", value: "Enabled" },
        { key: "S3 endpoint", value: zone.s3.endpoint ?? "-" },
      );
    }

    logger.log(formatKeyValue(rows, output));

    if (zone.s3.enabled) {
      logger.dim(
        `Run "bunny storage zones credentials ${zone.name}" for S3 keys.`,
      );
    }
  },
});
