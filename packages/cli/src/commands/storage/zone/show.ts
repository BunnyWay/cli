import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { toSafeStorageZone } from "../api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";
import { isS3Enabled } from "../s3.ts";
import { zoneDetailRows } from "./details.ts";

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

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      offerLink: true,
    });

    if (output === "json") {
      logger.log(JSON.stringify(toSafeStorageZone(zone), null, 2));
      return;
    }

    logger.log(formatKeyValue(zoneDetailRows(zone), output));

    if (isS3Enabled(zone)) {
      logger.dim(
        `Run "bunny storage zones credentials ${zone.Name}" for S3 keys.`,
      );
    }
  },
});
