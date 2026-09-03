import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import {
  connectStorageZone,
  uploadFile,
} from "@/commands/storage/files-api.ts";
import { resolveStorageZoneInteractive } from "@/commands/storage/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";

interface UploadArgs {
  file: string;
  zone?: string;
  to?: string;
  contentType?: string;
  checksum?: boolean;
}

/**
 * The remote path to upload to, or undefined when the prompt was cancelled.
 *
 * A blank answer means the zone root, so cancelling has to be distinguished from it:
 * treating both as "no destination" would upload to the root on Ctrl-C.
 */
export async function uploadDestination(
  file: string,
  to: string | undefined,
  interactive: boolean,
): Promise<string | undefined> {
  let destination = to;
  if (destination === undefined && interactive) {
    const { value } = await prompts({
      type: "text",
      name: "value",
      message: "Upload to (blank for the zone root):",
      initial: "",
    });
    if (value === undefined) return undefined;
    destination = value as string;
  }

  // A bare path uses the file as-is; a trailing slash means "into this directory".
  return !destination || destination.endsWith("/")
    ? `${destination ?? ""}${basename(file)}`
    : destination;
}

export const storageFileUploadCommand = defineCommand<UploadArgs>({
  command: "upload <file>",
  describe: "Upload a local file to a storage zone.",
  examples: [
    ["$0 storage files upload ./photo.png", "Upload to the linked zone's root"],
    [
      "$0 storage files upload ./photo.png --to images/photo.png",
      "Upload under a different name",
    ],
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
          "Remote path; a trailing slash uploads into that directory under the file's name (prompts if omitted)",
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
      // Bun.file reports a directory as missing, which reads as the wrong problem.
      const isDirectory = await stat(file)
        .then((entry) => entry.isDirectory())
        .catch(() => false);
      if (isDirectory) {
        throw new UserError(
          `${file} is a directory, and upload takes a single file.`,
          "Upload each file in turn, or use `bunny sites deploy` to publish a built directory.",
        );
      }
      throw new UserError(`File not found: ${file}`);
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      offerLink: true,
    });
    const connection = connectStorageZone(zone);

    const remotePath = await uploadDestination(file, to, isInteractive(output));
    if (remotePath === undefined) {
      logger.log("Cancelled.");
      return;
    }

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
