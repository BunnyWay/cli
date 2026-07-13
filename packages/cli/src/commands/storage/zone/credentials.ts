import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue, maskSecret } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";
import {
  isS3Enabled,
  renderS3ToolConfig,
  S3_TOOL_FORMATS,
  type S3ToolFormat,
  s3Credentials,
} from "../s3.ts";

interface CredentialsArgs {
  zone?: string;
  format?: S3ToolFormat;
  readOnly?: boolean;
  showSecret?: boolean;
}

export const storageZoneCredentialsCommand = defineCommand<CredentialsArgs>({
  command: "credentials [zone]",
  aliases: ["creds"],
  describe: "Show S3 credentials for a storage zone, or config for an S3 tool.",
  examples: [
    [
      "$0 storage zones credentials my-zone",
      "Show endpoint and keys (secret masked)",
    ],
    [
      "$0 storage zones credentials my-zone --show-secret",
      "Reveal the secret access key",
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
      .option("format", {
        type: "string",
        choices: S3_TOOL_FORMATS,
        describe: "Emit config for an S3 tool instead of the default table",
      })
      .option("read-only", {
        type: "boolean",
        default: false,
        describe: "Use the zone's read-only password as the secret",
      })
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe: "Reveal the secret access key (masked by default)",
      }),

  handler: async ({
    zone: ref,
    format,
    readOnly,
    showSecret,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveStorageZoneInteractive(client, ref, output);
    const creds = s3Credentials(zone, readOnly ?? false);

    if (!isS3Enabled(zone)) {
      logger.warn(
        `S3 is not enabled on ${zone.Name}. These credentials only work once it has S3 preview access.`,
      );
    }

    if (format) {
      logger.log(renderS3ToolConfig(format, creds, zone.Name as string));
      return;
    }

    if (output === "json") {
      // Mask by default like the table; --show-secret opts into the raw key.
      logger.log(
        JSON.stringify(
          {
            ...creds,
            secretAccessKey: showSecret
              ? creds.secretAccessKey
              : maskSecret(creds.secretAccessKey),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "Endpoint", value: creds.endpoint },
          { key: "Region", value: creds.region },
          { key: "Access Key ID", value: creds.accessKeyId },
          {
            key: "Secret Access Key",
            value: showSecret
              ? creds.secretAccessKey
              : maskSecret(creds.secretAccessKey),
          },
        ],
        output,
      ),
    );
    if (showSecret) {
      logger.warn("Treat the secret access key like a password.");
    } else {
      logger.dim("Secret masked. Pass --show-secret to reveal it.");
    }
  },
});
