import { storageFilesDelete } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm } from "../../../core/ui.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

export const storageFileRemoveCommand = defineActionCommand({
  action: storageFilesDelete,
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

  progress: "Deleting...",

  prepare: async (args, ctx) => {
    // Destructive: --force must not silently delete from a picked zone, and no link offer.
    const zone = await resolveStorageZoneInteractive(
      ctx.clients.core,
      args.zone,
      { output: args.output, force: args.force },
    );

    // A trailing slash deletes a directory and everything under it, recursively.
    const isDirectory = args.path.endsWith("/");
    return {
      input: { zone: String(zone.Id), path: args.path },
      confirm: () =>
        confirm(
          isDirectory
            ? `Delete directory ${args.path} and all of its contents from ${zone.Name}?`
            : `Delete ${args.path} from ${zone.Name}?`,
          { force: args.force },
        ),
    };
  },

  render: (result) => {
    logger.success(`Deleted ${result.path} from ${result.zone}.`);
  },
});
