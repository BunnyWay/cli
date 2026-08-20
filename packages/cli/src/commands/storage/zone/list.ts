import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatBytes, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import {
  fetchStorageZones,
  type StorageZoneModel,
  toSafeStorageZone,
} from "../api.ts";
import { zoneTierLabel } from "../constants.ts";
import { isS3Enabled } from "../s3.ts";

export const storageZoneListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List all storage zones.",
  examples: [
    ["$0 storage zones list", "List all storage zones"],
    ["$0 storage zones list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Fetching storage zones...");
    spin.start();
    let zones: StorageZoneModel[];
    try {
      zones = await fetchStorageZones(client);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(zones.map(toSafeStorageZone), null, 2));
      return;
    }

    if (zones.length === 0) {
      logger.info("No storage zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Region", "Tier", "S3", "Files", "Used"],
        zones.map((z) => [
          String(z.Id ?? ""),
          z.Name ?? "",
          z.Region ?? "",
          zoneTierLabel(z),
          isS3Enabled(z) ? "Yes" : "No",
          String(z.FilesStored ?? 0),
          formatBytes(z.StorageUsed ?? 0),
        ]),
        output,
      ),
    );
  },
});
