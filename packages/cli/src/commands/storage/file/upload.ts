import { basename } from "node:path";
import { storageFilesUpload } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { logger } from "../../../core/logger.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

export const storageFileUploadCommand = defineActionCommand({
  action: storageFilesUpload,
  command: "upload <file>",
  describe: "Upload a local file to a storage zone.",
  examples: [
    ["$0 storage files upload ./photo.png", "Upload to the linked zone's root"],
    [
      "$0 storage files upload ./photo.png --to images/",
      "Upload into a directory",
    ],
    [
      "$0 storage files upload ./photo.png --zone my-zone",
      "Upload to a specific zone",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Path to the local file to upload",
        demandOption: true,
      })
      .option("zone", {
        alias: "z",
        type: "string",
        describe: "Storage zone name or ID (defaults to the linked zone)",
      })
      .option("to", {
        type: "string",
        describe:
          "Remote path; a trailing slash uploads into that directory under the file's name",
      })
      .option("content-type", {
        type: "string",
        describe: "Override the stored content type",
      })
      .option("checksum", {
        type: "boolean",
        default: false,
        describe: "Send a SHA256 checksum so the server verifies the upload",
      }),

  // Overwriting is the point of an upload; running the command is the intent.
  skipConfirm: true,

  prepare: async (args, ctx) => {
    // A bare --to uses the path as-is; a trailing slash means "into this directory".
    const to = args.to;
    const path =
      !to || to.endsWith("/") ? `${to ?? ""}${basename(args.file)}` : to;

    const zone = await resolveStorageZoneInteractive(
      ctx.clients.core,
      args.zone,
      { output: args.output, offerLink: true },
    );

    return {
      input: {
        zone: String(zone.Id),
        source: args.file,
        path,
        contentType: args["content-type"],
        checksum: args.checksum,
      },
    };
  },

  progress: "Uploading...",

  render: (result) => {
    logger.success(`Uploaded ${result.path} to ${result.zone}.`);
  },
});
