import { defineCommand } from "../../../core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
} from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import {
  directPlayUrl,
  formatDuration,
  videoStatusLabel,
} from "../videos-api.ts";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "./interactive.ts";

interface VideoShowArgs {
  video?: string;
  lib?: string;
}

export const streamVideoShowCommand = defineCommand<VideoShowArgs>({
  command: "show [video]",
  describe: "Show details for a video.",
  examples: [
    ["$0 stream videos show 1a2b3c4d-...", "Show a video by GUID"],
    ["$0 stream videos show", "Pick a video interactively"],
    ["$0 stream videos show 1a2b3c4d-... --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", {
        type: "string",
        describe: "Video GUID",
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      }),

  handler: async ({ video: ref, lib, profile, output, verbose, apiKey }) => {
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
    });

    if (output === "json") {
      logger.log(JSON.stringify(video, null, 2));
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: video.guid },
          { key: "Title", value: video.title },
          { key: "Status", value: videoStatusLabel(video.status) },
          { key: "Size", value: formatBytes(video.storageSize ?? 0) },
          { key: "Length", value: formatDuration(video.length) },
          { key: "Resolutions", value: video.availableResolutions || "—" },
          { key: "Views", value: String(video.views ?? 0) },
          { key: "Collection", value: video.collectionId || "—" },
          { key: "Direct play", value: directPlayUrl(libraryId, video.guid) },
          { key: "Uploaded", value: formatDateTime(video.dateUploaded) },
        ],
        output,
      ),
    );
  },
});
