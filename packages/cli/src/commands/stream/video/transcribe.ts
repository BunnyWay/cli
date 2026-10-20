import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { parseCsvFlag } from "@/commands/stream/library/flags.ts";
import { checkTranscribingLanguages } from "@/commands/stream/library/language-check.ts";
import {
  autoTranscriptionPending,
  DOUBLE_BILLING_NOTE,
  estimateTranscription,
  formatTranscriptionEstimate,
  outputLanguages,
} from "@/commands/stream/transcription-cost.ts";
import {
  type TranscribeSettings,
  transcribeVideo,
} from "@/commands/stream/videos-api.ts";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface TranscribeArgs {
  video?: string;
  lib?: string;
  targetLanguages?: string;
  sourceLanguage?: string;
  generateTitle?: boolean;
  generateDescription?: boolean;
  generateChapters?: boolean;
  generateMoments?: boolean;
  overwrite?: boolean;
}

export const TRANSCRIBE_BILLING_NOTE =
  "Transcription is billed at $0.10 per language-minute of audio, for the source-language transcript and for each target language.";

/**
 * The transcribe body: only the settings that were asked for.
 *
 * Everything omitted falls back to the library's transcribing defaults, so an
 * empty body is a valid "just transcribe it" request.
 */
export function transcribeSettings(args: TranscribeArgs): TranscribeSettings {
  const settings: TranscribeSettings = {};

  if (args.targetLanguages !== undefined) {
    const languages = parseCsvFlag(args.targetLanguages);
    if (languages.length > 0) settings.targetLanguages = languages;
  }
  const source = args.sourceLanguage?.trim();
  if (source) settings.sourceLanguage = source;

  if (args.generateTitle !== undefined)
    settings.generateTitle = args.generateTitle;
  if (args.generateDescription !== undefined)
    settings.generateDescription = args.generateDescription;
  if (args.generateChapters !== undefined)
    settings.generateChapters = args.generateChapters;
  if (args.generateMoments !== undefined)
    settings.generateMoments = args.generateMoments;

  return settings;
}

export const streamVideoTranscribeCommand = defineCommand<TranscribeArgs>({
  command: "transcribe [video]",
  describe: "Transcribe a video's audio into captions (paid).",
  examples: [
    [
      "$0 stream videos transcribe 1a2b3c4d-...",
      "Transcribe with the library defaults",
    ],
    [
      "$0 stream videos transcribe 1a2b3c4d-... --target-languages en,de",
      "Transcribe into two languages",
    ],
    [
      "$0 stream videos transcribe 1a2b3c4d-... --source-language en --generate-title",
      "Name the spoken language and generate a title",
    ],
    [
      "$0 stream videos transcribe 1a2b3c4d-... --overwrite",
      "Overwrite the existing transcription, overriding the library defaults",
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
      .option("target-languages", {
        type: "string",
        describe:
          "Target languages, comma-separated ISO 639-1 codes (e.g. en,de)",
      })
      .option("source-language", {
        type: "string",
        describe: "Language spoken in the video, as an ISO 639-1 code",
      })
      .option("generate-title", {
        type: "boolean",
        describe: "Generate the video title from the transcript",
      })
      .option("generate-description", {
        type: "boolean",
        describe: "Generate the video description from the transcript",
      })
      .option("generate-chapters", {
        type: "boolean",
        describe: "Generate chapters from the transcript",
      })
      .option("generate-moments", {
        type: "boolean",
        describe: "Generate moments from the transcript",
      })
      .option("overwrite", {
        type: "boolean",
        describe:
          "Overwrite the existing transcription and override the library's transcribing defaults (sent as the API's force flag)",
      }),

  handler: async (args) => {
    const {
      video: ref,
      lib,
      overwrite,
      profile,
      output,
      verbose,
      apiKey,
    } = args;
    const settings = transcribeSettings(args);

    // Check requested output languages against the live list before anything is billed.
    await checkTranscribingLanguages(
      resolveConfig(profile, apiKey, verbose),
      settings.targetLanguages,
      verbose,
    );

    // --overwrite re-runs a billed transcription, so it must not also pick targets:
    // both resolutions error instead of prompting.
    const { client, library, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
      force: overwrite,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
      force: overwrite,
    });

    // Right after an upload or re-encode, a transcribing library is about to do this itself.
    if (output !== "json" && autoTranscriptionPending(library, video)) {
      logger.warn(
        `This library transcribes automatically once encoding finishes, and ${video.title} is still encoding, so it will be transcribed anyway.`,
      );
      logger.warn(DOUBLE_BILLING_NOTE);
    }

    // Text runs see the cost before the request; json output stays machine-clean.
    if (output !== "json") {
      const estimate = estimateTranscription(
        video.length,
        outputLanguages(
          settings.targetLanguages,
          library.TranscribingCaptionLanguages,
        ),
        settings.sourceLanguage,
      );
      logger.warn(
        `${TRANSCRIBE_BILLING_NOTE} ${formatTranscriptionEstimate(estimate)}`,
      );
    }

    const status = await withSpinner("Queueing transcription...", () =>
      transcribeVideo(client, libraryId, video.guid, settings, {
        force: overwrite,
      }),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: video.guid,
            title: video.title,
            queued: true,
            overwrite: Boolean(overwrite),
            ...settings,
            ...status,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Queued transcription for ${video.title}.`);
    logger.dim(
      "Once it finishes, the Captions row of `bunny stream videos show` lists the new languages.",
    );
  },
});
