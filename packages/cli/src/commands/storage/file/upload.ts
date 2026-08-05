import { basename } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { connectStorageZone, uploadFile } from "../files-api.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";

interface UploadArgs {
  file: string;
  zone?: string;
  to?: string;
  contentType?: string;
  checksum?: boolean;
}

export const storageFileUploadCommand = defineCommand<UploadArgs>({
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

  handler: async ({
    file,
    zone: ref,
    to,
    contentType,
    checksum,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const source = Bun.file(file);
    if (!(await source.exists())) {
      throw new UserError(`File not found: ${file}`);
    }

    // A bare path uses the file as-is; a trailing slash means "into this directory".
    const remotePath =
      !to || to.endsWith("/") ? `${to ?? ""}${basename(file)}` : to;

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      offerLink: true,
    });
    const connection = connectStorageZone(zone);

    const spin = spinner(`Uploading ${remotePath}...`);
    spin.start();
    try {
      const sha256Checksum = checksum ? await sha256(source) : undefined;
      await uploadFile(connection, remotePath, source.stream(), {
        contentType,
        sha256Checksum,
      });
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { zone: zone.Name, path: remotePath, uploaded: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Uploaded ${remotePath} to ${zone.Name}.`);
  },
});

// Hash in a streaming pass to avoid buffering the whole file in memory.
async function sha256(source: ReturnType<typeof Bun.file>): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of source.stream()) hasher.update(chunk);
  return hasher.digest("hex").toUpperCase();
}
