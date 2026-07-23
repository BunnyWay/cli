import { basename } from "node:path";
import { storageFilesDownload } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { logger } from "../../../core/logger.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

export const storageFileDownloadCommand = defineActionCommand({
  action: storageFilesDownload,
  command: "download <path>",
  describe: "Download a file from a storage zone.",
  examples: [
    [
      "$0 storage files download images/photo.png",
      "Download from the linked zone to the working directory",
    ],
    [
      "$0 storage files download images/photo.png --out ./local.png",
      "Download to a specific path",
    ],
    [
      "$0 storage files download images/photo.png --zone my-zone",
      "Download from a specific zone",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "Path to the file within the zone",
        demandOption: true,
      })
      .option("zone", {
        alias: "z",
        type: "string",
        describe: "Storage zone name or ID (defaults to the linked zone)",
      })
      .option("out", {
        type: "string",
        describe: "Local destination path (defaults to the file name)",
      }),

  progress: "Downloading...",

  prepare: async (args, ctx) => {
    const zone = await resolveStorageZoneInteractive(
      ctx.clients.core,
      args.zone,
      { output: args.output, offerLink: true },
    );
    return {
      input: {
        zone: String(zone.Id),
        path: args.path,
        destination: args.out ?? basename(args.path),
      },
    };
  },

  render: (result) => {
    logger.success(`Downloaded ${result.path} to ${result.destination}.`);
  },
});
