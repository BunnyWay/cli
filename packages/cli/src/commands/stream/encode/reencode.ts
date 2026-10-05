import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  estimateTranscription,
  formatTranscriptionEstimate,
  outputLanguages,
} from "@/commands/stream/transcription-cost.ts";
import {
  reencodeVideo,
  videoStatusLabel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface ReencodeArgs {
  video?: string;
  lib?: string;
}

export const streamEncodeReencodeCommand = defineCommand<ReencodeArgs>({
  command: "reencode [video]",
  describe: "Re-encode a video with the library's current encoding settings.",
  examples: [
    ["$0 stream encode reencode 1a2b3c4d-...", "Re-encode one video"],
    ["$0 stream encode reencode", "Pick a video interactively"],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      }),

  handler: async ({ video: ref, lib, profile, output, verbose, apiKey }) => {
    const { client, library, libraryId } = await streamLibraryContext({
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

    // Re-encoding works from the stored original; without it the API answers 400.
    if (video.hasOriginal === false) {
      throw new UserError(
        `${video.title} has no stored original file, so it can't be re-encoded.`,
        "Upload the video again; turn on --keep-original (bunny stream library update) to keep originals for new uploads.",
      );
    }

    // Re-encoding regenerates every rendition, so it is billed like a new encode.
    if (output !== "json") {
      logger.warn(
        "Re-encoding regenerates every output and is billed like the original encode (Premium Encoding rates apply on the premium tier).",
      );
      // A transcribing library re-queues and re-bills transcription too.
      if (library.EnableTranscribing) {
        const estimate = estimateTranscription(
          video.length,
          outputLanguages(undefined, library.TranscribingCaptionLanguages),
        );
        logger.warn(
          `Transcribing is on for this library, so it runs again: ${formatTranscriptionEstimate(estimate)}`,
        );
      }
    }

    const updated = await withSpinner("Queueing re-encode...", () =>
      reencodeVideo(client, libraryId, video.guid),
    );

    if (output === "json") {
      logger.log(JSON.stringify(updated, null, 2));
      return;
    }

    logger.success(`Queued a re-encode of ${updated.title}.`);
    logger.log(
      formatKeyValue(
        [
          { key: "Video ID", value: updated.guid },
          { key: "Status", value: videoStatusLabel(updated.status) },
        ],
        output,
      ),
    );
  },
});
