import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";
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
 * Whether the video has nothing for smart generation to read.
 *
 * Smart generation needs a transcript and never makes one: the API rejects the
 * request outright when the video has no captions, even on a library with
 * transcribing enabled. So this is a hard precondition, not a billing gate.
 */
export function hasNoCaptions(video: VideoModel): boolean {
  return (video.captions ?? []).length === 0;
}

/**
 * Refuse a video the API would refuse anyway, and name the way out.
 *
 * Sending the request would only come back as "Video has no captions", so the
 * transcribe pointer is more useful than the round trip.
 */
export function requireTranscript(video: VideoModel): void {
  if (!hasNoCaptions(video)) return;
  throw new UserError(
    `${video.title} has no captions, and smart generation needs a transcript.`,
    `Transcribe it first: bunny stream transcribe ${video.guid} (or add captions with "bunny stream caption add").`,
  );
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
      "Never fall back to a picker; the library and video must be named",
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
        describe:
          "Disable the library and video pickers, so the run only ever acts on what you named",
      }),

  handler: async (args) => {
    const { video: ref, lib, force, profile, output, verbose, apiKey } = args;
    const body = smartGenerateBody(args);

    // --force is picker-only here: both resolutions error instead of prompting,
    // like the delete commands, so a paid run never targets a guessed video.
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

    requireTranscript(video);

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
