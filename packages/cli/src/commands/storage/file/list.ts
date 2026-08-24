import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatBytes, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import {
  connectStorageZone,
  listFiles,
  type StorageFile,
} from "../files-api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

interface ListArgs {
  path?: string;
  zone?: string;
}

export const storageFileListCommand = defineCommand<ListArgs>({
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

  handler: async ({ path, zone: ref, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      offerLink: true,
    });
    const connection = connectStorageZone(zone);

    const spin = spinner("Listing files...");
    spin.start();
    let files: StorageFile[];
    try {
      files = await listFiles(connection, path ?? "");
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(files, null, 2));
      return;
    }

    if (files.length === 0) {
      const where = path ? `"${path}"` : "the zone root";
      logger.info(
        `No files found at ${where}. The path may be empty or not exist.`,
      );
      return;
    }

    const sorted = files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.objectName.localeCompare(b.objectName);
    });

    logger.log(
      formatTable(
        ["Name", "Type", "Size"],
        sorted.map((file) => [
          file.isDirectory ? `${file.objectName}/` : file.objectName,
          file.isDirectory ? "dir" : "file",
          file.isDirectory ? "-" : formatBytes(file.length),
        ]),
        output,
      ),
    );
  },
});
