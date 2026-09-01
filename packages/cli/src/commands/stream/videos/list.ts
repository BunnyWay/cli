import { defineCommand } from "../../../core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatTable,
} from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { withSpinner } from "../../../core/ui.ts";
import {
  fetchVideos,
  formatDuration,
  videoStatusLabel,
} from "../videos-api.ts";
import { streamLibraryContext } from "./interactive.ts";

interface VideoListArgs {
  lib?: string;
  search?: string;
}

export const streamVideoListCommand = defineCommand<VideoListArgs>({
  command: "list",
  aliases: ["ls"],
  describe: "List the videos in a Stream video library.",
  examples: [
    ["$0 stream videos list", "List videos in the linked library"],
    ["$0 stream videos list --lib 12345", "List videos in a specific library"],
    ["$0 stream videos list --search launch", "Filter by title"],
    [
      "$0 stream upload ./video.mp4",
      "Videos are added by uploading; there is no videos create",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("search", {
        type: "string",
        describe: "Only list videos matching this search term",
      }),

  handler: async ({ lib, search, profile, output, verbose, apiKey }) => {
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    const videos = await withSpinner("Fetching videos...", () =>
      fetchVideos(client, libraryId, { search }),
    );

    if (output === "json") {
      logger.log(JSON.stringify(videos, null, 2));
      return;
    }

    if (videos.length === 0) {
      logger.info("No videos found.");
      logger.dim("Add one with `bunny stream upload <file>`.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Title", "Status", "Size", "Length", "Views", "Uploaded"],
        videos.map((video) => [
          video.guid,
          video.title,
          videoStatusLabel(video.status),
          formatBytes(video.storageSize ?? 0),
          formatDuration(video.length),
          String(video.views ?? 0),
          formatDateTime(video.dateUploaded),
        ]),
        output,
      ),
    );
  },
});
