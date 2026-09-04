import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  directPlayUrl,
  formatDuration,
  type VideoModel,
  videoStatusLabel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatBytes, formatDateTime, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

interface VideoShowArgs {
  video?: string;
  lib?: string;
}

/**
 * The caption languages on a video, as a count plus their codes.
 *
 * `stream transcribe` and `stream smart` point here to check their results, so
 * the row has to say what is actually present.
 */
export function captionSummary(video: VideoModel): string {
  const captions = video.captions ?? [];
  if (captions.length === 0) return "—";
  const codes = captions
    .map((caption) => caption.srclang ?? "?")
    .filter(Boolean);
  return `${captions.length} (${codes.join(", ")})`;
}

export const streamVideoShowCommand = defineCommand<VideoShowArgs>({
  command: "show [video]",
  describe: "Show details for a video.",
  examples: [
    ["$0 stream video show 1a2b3c4d-...", "Show a video by GUID"],
    ["$0 stream video show", "Pick a video interactively"],
    ["$0 stream video show 1a2b3c4d-... --output json", "JSON output"],
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
          { key: "Captions", value: captionSummary(video) },
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
