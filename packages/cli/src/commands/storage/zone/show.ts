import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
} from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { toSafeStorageZone } from "../api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";
import { isS3Enabled, s3Endpoint } from "../s3.ts";

interface ShowArgs {
  zone?: string;
}

export const storageZoneShowCommand = defineCommand<ShowArgs>({
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

  handler: async ({ zone: ref, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, output);

    if (output === "json") {
      logger.log(JSON.stringify(toSafeStorageZone(zone), null, 2));
      return;
    }

    const replication = (zone.ReplicationRegions ?? []).join(", ") || "-";

    const rows = [
      { key: "ID", value: String(zone.Id ?? "") },
      { key: "Name", value: zone.Name ?? "" },
      { key: "Region", value: zone.Region ?? "-" },
      { key: "Replication", value: replication },
      { key: "Hostname", value: zone.StorageHostname ?? "-" },
      { key: "Files", value: String(zone.FilesStored ?? 0) },
      { key: "Used", value: formatBytes(zone.StorageUsed ?? 0) },
      { key: "Modified", value: formatDateTime(zone.DateModified) },
    ];

    if (isS3Enabled(zone)) {
      rows.push(
        { key: "S3 compatible", value: "Enabled" },
        { key: "S3 endpoint", value: s3Endpoint(zone) },
      );
    }

    logger.log(formatKeyValue(rows, output));

    if (isS3Enabled(zone)) {
      logger.dim(
        `Run "bunny storage zones credentials ${zone.Name}" for S3 keys.`,
      );
    }
  },
});
