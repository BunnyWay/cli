import { basename } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { connectStorageZone, downloadFile } from "../files-api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

interface DownloadArgs {
  zone: string;
  path: string;
  out?: string;
}

export const storageFileDownloadCommand = defineCommand<DownloadArgs>({
  command: "download <zone> <path>",
  describe: "Download a file from a storage zone.",
  examples: [
    [
      "$0 storage files download my-zone images/photo.png",
      "Download to the working directory",
    ],
    [
      "$0 storage files download my-zone images/photo.png --out ./local.png",
      "Download to a specific path",
    ],
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
        describe: "Path to the file within the zone",
        demandOption: true,
      })
      .option("out", {
        type: "string",
        describe: "Local destination path (defaults to the file name)",
      }),

  handler: async ({
    zone: ref,
    path,
    out,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref);
    const connection = connectStorageZone(zone);
    const dest = out ?? basename(path);

    const spin = spinner(`Downloading ${path}...`);
    spin.start();
    try {
      const { response } = await downloadFile(connection, path);
      await Bun.write(dest, await response.arrayBuffer());
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify({ zone: zone.Name, path, out: dest }, null, 2));
      return;
    }

    logger.success(`Downloaded ${path} to ${dest}.`);
  },
});
