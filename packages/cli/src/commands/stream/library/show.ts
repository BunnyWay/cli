import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
} from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { toSafeVideoLibrary } from "../api.ts";
import { resolveLibraryInteractive } from "../interactive.ts";

interface LibraryShowArgs {
  library?: string;
}

export const streamLibraryShowCommand = defineCommand<LibraryShowArgs>({
  command: "show [library]",
  describe: "Show details for a Stream video library.",
  examples: [
    ["$0 stream library show my-library", "Show library details"],
    ["$0 stream library show 12345", "Show a library by ID"],
    ["$0 stream library show my-library --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs.positional("library", {
      type: "string",
      describe: "Video library name or ID",
    }),

  handler: async ({ library, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const lib = await resolveLibraryInteractive(client, library, {
      output,
      offerLink: true,
    });

    if (output === "json") {
      logger.log(JSON.stringify(toSafeVideoLibrary(lib), null, 2));
      return;
    }

    // No output format prints the raw keys; `bunny stream library credentials`
    // is the deliberate way to retrieve them.
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
          { key: "Created", value: formatDateTime(lib.DateCreated) },
          { key: "Modified", value: formatDateTime(lib.DateModified) },
        ],
        output,
      ),
    );
    logger.dim(
      `Run "bunny stream library credentials ${lib.Name}" for the API key.`,
    );
  },
});
