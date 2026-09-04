import { streamLibraryContext } from "@/commands/stream/context.ts";
import {
  fetchVideos,
  formatDuration,
  videoStatusLabel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatBytes, formatDateTime, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface VideoListArgs {
  lib?: string;
  search?: string;
  collection?: string;
}

export const streamVideoListCommand = defineCommand<VideoListArgs>({
  command: "list",
  aliases: ["ls"],
  describe: "List the videos in a Stream video library.",
  examples: [
    ["$0 stream video list", "List videos in the linked library"],
    ["$0 stream video list --lib 12345", "List videos in a specific library"],
    ["$0 stream video list --search launch", "Filter by title"],
    [
      "$0 stream video list --collection 8a7b6c5d-...",
      "Only videos in one collection",
    ],
    [
      "$0 stream video upload ./video.mp4",
      "Videos are added with upload or fetch; there is no video create",
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
      })
      .option("collection", {
        type: "string",
        describe:
          "Only list videos in this collection ID (see `bunny stream collection list`)",
      }),

  handler: async ({
    lib,
    search,
    collection,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    const videos = await withSpinner("Fetching videos...", () =>
      fetchVideos(client, libraryId, {
        search,
        collection: collection?.trim() || undefined,
      }),
    );

    if (output === "json") {
      logger.log(JSON.stringify(videos, null, 2));
      return;
    }

    if (videos.length === 0) {
      logger.info("No videos found.");
      logger.dim("Add one with `bunny stream video upload <file>`.");
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
