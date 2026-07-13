import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { connectStorageZone, deleteFile } from "../files-api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

interface RemoveArgs {
  path: string;
  zone?: string;
  force?: boolean;
}

export const storageFileRemoveCommand = defineCommand<RemoveArgs>({
  command: "remove <path>",
  aliases: ["rm"],
  describe: "Delete a file or directory from a storage zone.",
  examples: [
    ["$0 storage files remove images/photo.png", "Delete a file"],
    [
      "$0 storage files remove images/ --force",
      "Delete a directory without confirmation",
    ],
    [
      "$0 storage files remove images/photo.png --zone my-zone",
      "Delete from a specific zone",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "Path to the file or directory within the zone",
        demandOption: true,
      })
      .option("zone", {
        alias: "z",
        type: "string",
        describe: "Storage zone name or ID (defaults to the linked zone)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    path,
    zone: ref,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, output);
    const connection = connectStorageZone(zone);

    // A trailing slash deletes a directory and everything under it, recursively.
    const isDirectory = path.endsWith("/");
    const confirmed = await confirm(
      isDirectory
        ? `Delete directory ${path} and all of its contents from ${zone.Name}?`
        : `Delete ${path} from ${zone.Name}?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const spin = spinner("Deleting...");
    spin.start();
    try {
      await deleteFile(connection, path);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify({ zone: zone.Name, path, removed: true }, null, 2),
      );
      return;
    }

    logger.success(`Deleted ${path} from ${zone.Name}.`);
  },
});
