import { createCoreClient } from "@bunny.net/openapi-client";
import { toSafeVideoLibrary } from "@/commands/stream/api.ts";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
  redactUrl,
} from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

interface LibraryShowArgs {
  library?: string;
  showSecret?: boolean;
}

export const streamLibraryShowCommand = defineCommand<LibraryShowArgs>({
  command: "show [library]",
  describe: "Show details for a Stream video library.",
  examples: [
    ["$0 stream libraries show my-library", "Show library details"],
    ["$0 stream libraries show 12345", "Show a library by ID"],
    ["$0 stream libraries show my-library --output json", "JSON output"],
    [
      "$0 stream libraries show my-library --show-secret",
      "Show the webhook and VAST URLs in full",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("library", {
        type: "string",
        describe: "Video library name or ID",
      })
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe:
          "Show the webhook and VAST URLs in full (their query string and userinfo are redacted by default)",
      }),

  handler: async ({
    library,
    showSecret,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const lib = await resolveLibraryInteractive(client, library, {
      output,
      offerLink: true,
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(toSafeVideoLibrary(lib, { showSecret }), null, 2),
      );
      return;
    }

    // No output format prints the raw keys; `bunny stream libraries credentials`
    // is the deliberate way to retrieve them.
    const url = (value: string | null | undefined) =>
      value && !showSecret ? redactUrl(value) : value;
    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(lib.Id ?? "") },
          { key: "Name", value: lib.Name ?? "" },
          { key: "Videos", value: String(lib.VideoCount ?? 0) },
          { key: "Storage", value: formatBytes(lib.StorageUsage ?? 0) },
          { key: "Traffic", value: formatBytes(lib.TrafficUsage ?? 0) },
          {
            key: "Replication regions",
            value: (lib.ReplicationRegions ?? []).join(", ") || "—",
          },
          { key: "Pull zone ID", value: String(lib.PullZoneId ?? "—") },
          { key: "Storage zone ID", value: String(lib.StorageZoneId ?? "—") },
          { key: "Enabled resolutions", value: lib.EnabledResolutions ?? "—" },
          {
            key: "Token auth",
            value: lib.PlayerTokenAuthenticationEnabled
              ? "Enabled"
              : "Disabled",
          },
          { key: "DRM", value: lib.EnableDRM ? "Enabled" : "Disabled" },
          {
            key: "Transcribing",
            value: lib.EnableTranscribing ? "Enabled" : "Disabled",
          },
          { key: "Webhook URL", value: url(lib.WebhookUrl) || "—" },
          { key: "VAST ads", value: url(lib.VastTagUrl) || "Off" },
          {
            key: "Watermark",
            value: lib.HasWatermark ? "Set" : "None",
          },
          { key: "Created", value: formatDateTime(lib.DateCreated) },
          { key: "Modified", value: formatDateTime(lib.DateModified) },
        ],
        output,
      ),
    );
    logger.dim(
      `Run "bunny stream libraries credentials ${lib.Name}" for the API key.`,
    );
  },
});
