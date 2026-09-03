import { createCoreClient } from "@bunny.net/openapi-client";
import {
  connectStorageZone,
  deleteFile,
  isZoneRoot,
} from "@/commands/storage/files-api.ts";
import { resolveStorageZoneInteractive } from "@/commands/storage/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import {
  confirm,
  confirmTyped,
  requireConfirmable,
  spinner,
} from "@/core/ui.ts";

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
    ["$0 storage files remove /", "Delete every file in the zone"],
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

    // Destructive: --force must not silently delete from a picked zone, and no link offer.
    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      force,
    });
    const connection = connectStorageZone(zone);

    // A trailing slash deletes a directory and everything under it, recursively.
    const isDirectory = path.endsWith("/");
    const isRoot = isZoneRoot(path);
    requireConfirmable(output, {
      force,
      message: isRoot
        ? `Emptying ${zone.Name} needs a confirmation prompt.`
        : `Deleting "${path}" needs a confirmation prompt.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    const confirmed = await confirm(
      isRoot
        ? `Delete every file in ${zone.Name}? This cannot be undone.`
        : isDirectory
          ? `Delete directory ${path} and all of its contents from ${zone.Name}?`
          : `Delete ${path} from ${zone.Name}?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    // Emptying the zone root is as destructive as deleting the zone, so match its typed confirmation.
    if (isRoot && !(await confirmTyped(zone.Name ?? "", { force }))) {
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

    logger.success(
      isRoot
        ? `Deleted all files from ${zone.Name}.`
        : `Deleted ${path} from ${zone.Name}.`,
    );
  },
});
