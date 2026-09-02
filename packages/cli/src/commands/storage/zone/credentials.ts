import { createCoreClient } from "@bunny.net/openapi-client";
import {
  CLIENT_FORMATS,
  type ClientFormat,
  CONNECTION_TYPES,
  type ConnectionType,
  clientType,
  connectionJson,
  offerConnectionEnv,
  printConnection,
  promptClient,
  promptConnectionType,
  storageConnection,
} from "@/commands/storage/connection.ts";
import { resolveStorageZoneInteractive } from "@/commands/storage/interactive.ts";
import { isS3Enabled } from "@/commands/storage/s3.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive } from "@/core/ui.ts";

interface CredentialsArgs {
  zone?: string;
  connection?: ConnectionType;
  format?: ClientFormat;
  readOnly?: boolean;
  showSecret?: boolean;
  saveEnv?: boolean;
}

export const storageZoneCredentialsCommand = defineCommand<CredentialsArgs>({
  command: "credentials [zone]",
  aliases: ["creds"],
  describe: "Show connection credentials for a storage zone.",
  examples: [
    [
      "$0 storage zones credentials my-zone",
      "Pick a connection type and show its credentials",
    ],
    [
      "$0 storage zones credentials my-zone --connection ftp --show-secret",
      "Show FTP credentials with the password revealed",
    ],
    [
      "$0 storage zones credentials my-zone --format sdk",
      "Print a @bunny.net/storage-sdk snippet",
    ],
    [
      "$0 storage zones credentials my-zone --format rclone >> ~/.config/rclone/rclone.conf",
      "Append an rclone remote",
    ],
    [
      'eval "$(bunny storage zones credentials my-zone --format env)"',
      "Export AWS-compatible env vars",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("zone", {
        type: "string",
        describe: "Storage zone name or ID",
      })
      .option("connection", {
        type: "string",
        choices: CONNECTION_TYPES,
        describe: "Connection type: http (HTTP API), ftp, or s3",
      })
      .option("format", {
        type: "string",
        choices: CLIENT_FORMATS,
        describe:
          "Emit client config (sdk, rclone, aws, s3cmd, env) instead of the table",
      })
      .option("read-only", {
        type: "boolean",
        default: false,
        describe: "Use the zone's read-only password as the secret",
      })
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe: "Reveal the secret (masked by default)",
      })
      .option("save-env", {
        type: "boolean",
        describe: "Save the connection's variables to .env (skips the prompt)",
      }),

  handler: async ({
    zone: ref,
    connection,
    format,
    readOnly,
    showSecret,
    saveEnv,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    if (format && connection && clientType(format) !== connection) {
      throw new UserError(
        `--format ${format} is ${clientType(format)} config, but --connection ${connection} was given.`,
        `Drop --format, or pass --connection ${clientType(format)}.`,
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      offerLink: true,
    });

    const interactive = isInteractive(output);
    // Flags are taken as given; only the unguided path opens a picker.
    let type = connection ?? (format ? clientType(format) : undefined);
    let toolFormat = format;
    if (!type && interactive) {
      type = await promptConnectionType(zone);
      if (!type) return;
      toolFormat = await promptClient(type);
    }
    // Callers from before the picker existed still expect S3.
    type ??= "s3";

    if (type === "s3" && !isS3Enabled(zone)) {
      logger.warn(
        `S3 is not enabled on ${zone.Name}, so these credentials will not work.`,
      );
    }

    const conn = storageConnection(zone, type, { readOnly });

    if (output === "json") {
      await offerConnectionEnv(conn, { saveEnv, interactive: false });
      // A client config is paste-ready by definition, so it carries the secret even when the fields are masked.
      if (toolFormat && !showSecret) {
        logger.warn("Treat the config in this payload like a password.");
      }
      logger.log(
        JSON.stringify(
          connectionJson(conn, {
            mask: !showSecret,
            client: toolFormat
              ? { zone, format: toolFormat, readOnly }
              : undefined,
          }),
          null,
          2,
        ),
      );
      return;
    }

    printConnection(zone, conn, {
      output,
      mask: !showSecret,
      format: toolFormat,
      readOnly,
    });
    await offerConnectionEnv(conn, { saveEnv, interactive });
  },
});
