import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import { resolveVideoInteractive, streamLibraryContext } from "./context.ts";
import {
  type SmartGenerateModel,
  smartGenerateVideo,
  type VideoModel,
} from "./videos-api.ts";

interface SmartArgs {
  video?: string;
  lib?: string;
  title?: boolean;
  description?: boolean;
  chapters?: boolean;
  moments?: boolean;
  sourceLanguage?: string;
  force?: boolean;
}

const TRANSCRIPTION_NOTE =
  "No captions found on this video, so smart generation will also transcribe the audio at $0.10 per language-minute.";

/**
 * The generation request, requiring at least one thing to generate.
 *
 * The API would accept an all-false body and do nothing, which bills nothing but
 * reads as success, so it is refused here.
 */
export function smartGenerateBody(args: SmartArgs): SmartGenerateModel {
  const body: SmartGenerateModel = {};
  if (args.title) body.generateTitle = true;
  if (args.description) body.generateDescription = true;
  if (args.chapters) body.generateChapters = true;
  if (args.moments) body.generateMoments = true;

  if (Object.keys(body).length === 0) {
    throw new UserError(
      "Nothing to generate.",
      "Pass at least one of --title, --description, --chapters, --moments.",
    );
  }

  const source = args.sourceLanguage?.trim();
  if (source) body.sourceLanguage = source;
  return body;
}

/**
 * Whether smart generation on this video will also pay for a transcription.
 *
 * Smart generation reads the transcript, so a video with no captions gets
 * transcribed first, which is billed. That turns a cheap call into a metered one
 * and is worth a confirmation.
 */
export function needsTranscription(video: VideoModel): boolean {
  return (video.captions ?? []).length === 0;
}

export const streamSmartCommand = defineCommand<SmartArgs>({
  command: "smart [video]",
  describe:
    "Generate a title, description, chapters, or moments from a video's transcript (paid).",
  examples: [
    [
      "$0 stream smart 1a2b3c4d-... --title --description",
      "Generate a title and description",
    ],
    [
      "$0 stream smart 1a2b3c4d-... --chapters --moments",
      "Generate chapters and moments",
    ],
    [
      "$0 stream smart 1a2b3c4d-... --title --force",
      "Skip the transcription-cost confirmation",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("title", { type: "boolean", describe: "Generate the title" })
      .option("description", {
        type: "boolean",
        describe: "Generate the description",
      })
      .option("chapters", { type: "boolean", describe: "Generate chapters" })
      .option("moments", { type: "boolean", describe: "Generate moments" })
      .option("source-language", {
        type: "string",
        describe: "Language spoken in the video, as an ISO 639-1 code",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip the confirmation when a transcription is needed",
      }),

  handler: async (args) => {
    const { video: ref, lib, force, profile, output, verbose, apiKey } = args;
    const body = smartGenerateBody(args);

    // --force accepts a metered charge, so it must not also pick targets: both
    // resolutions error instead of prompting, like the delete commands.
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
      force,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
      force,
    });

    // Only gate when the call would add a transcription charge on top.
    if (needsTranscription(video)) {
      logger.warn(TRANSCRIPTION_NOTE);
      requireConfirmable(output, {
        force,
        message: "Transcribing this video needs a confirmation prompt.",
        hint: "Re-run with --force to accept the transcription cost non-interactively.",
      });
      const confirmed = await confirm(
        `Generate from ${video.title}, transcribing its audio first?`,
        { force },
      );
      if (!confirmed) {
        logger.log("Cancelled.");
        return;
      }
    }

    const status = await withSpinner("Queueing smart generation...", () =>
      smartGenerateVideo(client, libraryId, video.guid, body),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: video.guid,
            title: video.title,
            queued: true,
            ...body,
            ...status,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Queued smart generation for ${video.title}.`);
    logger.dim(
      "Results land on the video itself; `bunny stream video show --output json` carries the per-feature status while it runs.",
    );
  },
});
