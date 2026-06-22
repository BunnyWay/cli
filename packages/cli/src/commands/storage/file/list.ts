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
  zone: string;
  path?: string;
}

export const storageFileListCommand = defineCommand<ListArgs>({
  command: "list <zone> [path]",
  aliases: ["ls"],
  describe: "List files in a storage zone directory.",
  examples: [
    ["$0 storage files list my-zone", "List files at the zone root"],
    ["$0 storage files list my-zone images/", "List files in a directory"],
  ],

  builder: (yargs) =>
    yargs
      .positional("zone", {
        type: "string",
        describe: "Storage zone name or ID",
        demandOption: true,
      })
      .positional("path", {
        type: "string",
        describe: "Directory path within the zone (defaults to the root)",
      }),

  handler: async ({ zone: ref, path, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, output);
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
      // Drop the SDK-internal _tag and the lazy data() loader.
      const plain = files.map((file) => ({
        ...file,
        _tag: undefined,
        data: undefined,
      }));
      logger.log(JSON.stringify(plain, null, 2));
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
