import { storageFilesList } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatBytes, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

export const storageFileListCommand = defineActionCommand({
  action: storageFilesList,
  command: "list [path]",
  aliases: ["ls"],
  describe: "List files in a storage zone directory.",
  examples: [
    ["$0 storage files list", "List the linked zone's root"],
    ["$0 storage files list images/", "List files in a directory"],
    ["$0 storage files list --zone my-zone", "List another zone's root"],
  ],

  builder: (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "Directory path within the zone (defaults to the root)",
      })
      .option("zone", {
        alias: "z",
        type: "string",
        describe: "Storage zone name or ID (defaults to the linked zone)",
      }),

  progress: "Listing files...",

  prepare: async (args, ctx) => {
    const zone = await resolveStorageZoneInteractive(
      ctx.clients.core,
      args.zone,
      { output: args.output, offerLink: true },
    );
    return { input: { zone: String(zone.Id), path: args.path ?? "" } };
  },

  render: (files, args) => {
    if (files.length === 0) {
      const where = args.path ? `"${args.path}"` : "the zone root";
      logger.info(
        `No files found at ${where}. The path may be empty or not exist.`,
      );
      return;
    }

    logger.log(
      formatTable(
        ["Name", "Type", "Size"],
        files.map((file) => [
          file.isDirectory ? `${file.name}/` : file.name,
          file.isDirectory ? "dir" : "file",
          file.isDirectory ? "-" : formatBytes(file.size),
        ]),
        args.output,
      ),
    );
  },
});
