import { createCoreClient } from "@bunny.net/openapi-client";
import {
  fetchLibraries,
  toSafeVideoLibrary,
  type VideoLibraryModel,
} from "@/commands/stream/api.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatBytes, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { spinner } from "@/core/ui.ts";

export const streamLibraryListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List all Stream video libraries.",
  examples: [
    ["$0 stream library list", "List all video libraries"],
    ["$0 stream library list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Fetching video libraries...");
    spin.start();
    let libraries: VideoLibraryModel[];
    try {
      libraries = await fetchLibraries(client);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(libraries.map(toSafeVideoLibrary), null, 2));
      return;
    }

    if (libraries.length === 0) {
      logger.info("No video libraries found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Videos", "Storage", "Traffic", "Regions"],
        libraries.map((lib) => [
          String(lib.Id ?? ""),
          lib.Name ?? "",
          String(lib.VideoCount ?? 0),
          formatBytes(lib.StorageUsage ?? 0),
          formatBytes(lib.TrafficUsage ?? 0),
          (lib.ReplicationRegions ?? []).join(", "),
        ]),
        output,
      ),
    );
  },
});
