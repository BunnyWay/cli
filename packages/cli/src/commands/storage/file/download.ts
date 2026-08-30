import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive, spinner } from "../../../core/ui.ts";
import { connectStorageZone, downloadFile } from "../files-api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";
import { promptStoragePath } from "./pick.ts";

interface DownloadArgs {
  path?: string;
  zone?: string;
  out?: string;
}

export const storageFileDownloadCommand = defineCommand<DownloadArgs>({
  command: "download [path]",
  describe: "Download a file from a storage zone.",
  examples: [
    ["$0 storage files download", "Browse the zone and pick a file"],
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
        describe: "Path to the file within the zone (prompts if omitted)",
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

  handler: async ({
    path: pathArg,
    zone: ref,
    out,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      offerLink: true,
    });
    const connection = connectStorageZone(zone);

    const path =
      pathArg ??
      (isInteractive(output)
        ? await promptStoragePath(connection, {
            message: "Pick a file to download",
          })
        : undefined);
    if (!path) {
      if (pathArg === undefined && !isInteractive(output))
        throw new UserError(
          "No file given.",
          "Pass a path, or run interactively to browse the zone.",
        );
      logger.log("Cancelled.");
      return;
    }

    const dest = out ?? basename(path);

    const spin = spinner(`Downloading ${path}...`);
    spin.start();
    try {
      // Stream to disk so multi-GB objects don't have to fit in memory.
      // FileSink, unlike Bun.write, won't create the parent dir for --out paths.
      await mkdir(dirname(dest), { recursive: true });
      const { stream } = await downloadFile(connection, path);
      const sink = Bun.file(dest).writer();
      try {
        for await (const chunk of stream) {
          sink.write(chunk);
        }
        await sink.end();
      } catch (err) {
        // Don't leave a truncated file behind on a failed download.
        await Promise.resolve(sink.end()).catch(() => {});
        await Bun.file(dest)
          .unlink()
          .catch(() => {});
        throw err;
      }
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
