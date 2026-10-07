import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { resolveVideoInteractive, streamLibraryContext } from "./context.ts";
import {
  AUTO_CAPTION_HINT,
  captionLanguages,
  resolveSmartSource,
} from "./smart-source.ts";
import { hasCaptions, offerTranscription } from "./smart-transcribe.ts";
import {
  type SmartGenerateModel,
  smartGenerateVideo,
  transcribeVideo,
} from "./videos-api.ts";

interface SmartArgs {
  video?: string;
  lib?: string;
  title?: boolean;
  description?: boolean;
  chapters?: boolean;
  moments?: boolean;
  sourceLanguage?: string;
  transcribe?: boolean;
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
      "$0 stream smart 1a2b3c4d-... --chapters --transcribe",
      "Transcribe a captionless video first (billed per language-minute)",
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
        describe:
          "Caption track to generate from, e.g. en. Auto-generated captions are labelled <code>-auto (e.g. en-auto); en falls back to en-auto when that's the only English track. Omitted: the -auto transcript is used, or you're asked when there are several. With no captions, the spoken language to transcribe",
      })
      .option("transcribe", {
        type: "boolean",
        default: false,
        describe:
          "If the video has no captions, transcribe it first without asking (paid; required to do so unattended)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe:
          "Disable the library and video pickers, so the run only ever acts on what you named",
      }),

  handler: async (args) => {
    const {
      video: ref,
      lib,
      force,
      transcribe,
      profile,
      output,
      verbose,
      apiKey,
    } = args;
    const body = smartGenerateBody(args);

    // --force is picker-only here: both resolutions error instead of prompting,
    // like the delete commands, so a paid run never targets a guessed video.
    const { client, library, libraryId } = await streamLibraryContext({
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

    // No transcript: offer to transcribe first instead of refusing. The same
    // generate flags ride on the transcribe request, so one call does both.
    if (!hasCaptions(video)) {
      const settings = await offerTranscription(video, library, body, {
        output,
        transcribe,
      });
      if (!settings) {
        logger.info(
          `Nothing was sent. Add captions you already have with "bunny stream caption add", then re-run.`,
        );
        return;
      }

      const status = await withSpinner("Queueing transcription...", () =>
        transcribeVideo(client, libraryId, video.guid, settings),
      );

      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              id: video.guid,
              title: video.title,
              queued: true,
              transcribing: true,
              ...settings,
              ...status,
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.success(
        `Queued transcription for ${video.title}; the requested fields are generated from the new transcript.`,
      );
      return;
    }

    // The API matches sourceLanguage against caption codes exactly and otherwise
    // takes the first track, so pick the track here: `en` → `en-auto` when that's
    // all there is, and the -auto transcript (or a choice) when nothing was named.
    const source = resolveSmartSource(
      captionLanguages(video),
      args.sourceLanguage,
    );
    if ("choose" in source) {
      if (force || !isInteractive(output)) {
        throw new UserError(
          `${video.title} has captions in several languages: ${source.choose.join(", ")}.`,
          `Pick the transcript to use with --source-language, e.g. --source-language ${source.choose[0]}. ${AUTO_CAPTION_HINT}`,
        );
      }
      const { language } = await prompts({
        type: "select",
        name: "language",
        message: "Captions to generate from:",
        choices: source.choose.map((code) => ({ title: code, value: code })),
      });
      if (!language) {
        logger.log("Cancelled.");
        return;
      }
      body.sourceLanguage = language;
    } else {
      body.sourceLanguage = source.language;
      if (output !== "json" && source.reason === "matched") {
        logger.dim(
          `No ${args.sourceLanguage?.trim()} captions; using ${source.language} instead.`,
        );
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
