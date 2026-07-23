import { storageZonesCredentials } from "@bunny.net/actions";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { formatKeyValue, maskSecret } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { resolveStorageZoneInteractive } from "../interactive.ts";
import {
  renderS3ToolConfig,
  S3_TOOL_FORMATS,
  type S3ToolFormat,
} from "../s3.ts";

export const storageZoneCredentialsCommand = defineActionCommand({
  action: storageZonesCredentials,
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

  progress: "Fetching credentials...",

  prepare: async (args, ctx) => {
    const zone = await resolveStorageZoneInteractive(
      ctx.clients.core,
      args.zone,
      { output: args.output, offerLink: true },
    );
    return {
      input: { zone: String(zone.Id), readOnly: args["read-only"] },
    };
  },

  after: (creds) => {
    if (!creds.s3Enabled) {
      logger.warn(
        `S3 is not enabled on ${creds.zone}. These credentials only work once it has S3 preview access.`,
      );
    }
  },

  // A tool config is the whole point of --format, so it wins over --output.
  emit: (creds, args) => {
    const format = args.format as S3ToolFormat | undefined;
    if (!format) return false;
    logger.log(renderS3ToolConfig(format, creds, creds.zone));
    return true;
  },

  // The action returns the secret in full; masking it is this surface's decision.
  json: (creds, args) =>
    args["show-secret"]
      ? creds
      : { ...creds, secretAccessKey: maskSecret(creds.secretAccessKey) },

  render: (creds, args) => {
    logger.log(
      formatKeyValue(
        [
          { key: "Endpoint", value: creds.endpoint },
          { key: "Region", value: creds.region },
          { key: "Access Key ID", value: creds.accessKeyId },
          {
            key: "Secret Access Key",
            value: args["show-secret"]
              ? creds.secretAccessKey
              : maskSecret(creds.secretAccessKey),
          },
        ],
        args.output,
      ),
    );
    if (args["show-secret"]) {
      logger.warn("Treat the secret access key like a password.");
    } else {
      logger.dim("Secret masked. Pass --show-secret to reveal it.");
    }
  },
});
