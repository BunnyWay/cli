import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";
import { resolveVideoInteractive, streamLibraryContext } from "./context.ts";
import { parseCsvFlag } from "./library/flags.ts";
import { type TranscribeSettings, transcribeVideo } from "./videos-api.ts";

interface TranscribeArgs {
  video?: string;
  lib?: string;
  languages?: string;
  sourceLanguage?: string;
  generateTitle?: boolean;
  generateDescription?: boolean;
  generateChapters?: boolean;
  generateMoments?: boolean;
  force?: boolean;
}

export const TRANSCRIBE_BILLING_NOTE =
  "Transcription is billed at $0.10 per language-minute of audio.";

/**
 * The transcribe body: only the settings that were asked for.
 *
 * Everything omitted falls back to the library's transcribing defaults, so an
 * empty body is a valid "just transcribe it" request.
 */
export function transcribeSettings(args: TranscribeArgs): TranscribeSettings {
  const settings: TranscribeSettings = {};

  if (args.languages !== undefined) {
    const languages = parseCsvFlag(args.languages);
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

export const streamTranscribeCommand = defineCommand<TranscribeArgs>({
  command: "transcribe [video]",
  describe: "Transcribe a video's audio into captions (paid).",
  examples: [
    [
      "$0 stream transcribe 1a2b3c4d-...",
      "Transcribe with the library defaults",
    ],
    [
      "$0 stream transcribe 1a2b3c4d-... --languages en,de",
      "Transcribe into two languages",
    ],
    [
      "$0 stream transcribe 1a2b3c4d-... --source-language en --generate-title",
      "Name the spoken language and generate a title",
    ],
    [
      "$0 stream transcribe 1a2b3c4d-... --force",
      "Re-run, overriding the library defaults",
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
      .option("languages", {
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
      .option("force", {
        alias: "f",
        type: "boolean",
        describe:
          "Re-run and override the library's transcribing defaults (the API's force flag)",
      }),

  handler: async (args) => {
    const { video: ref, lib, force, profile, output, verbose, apiKey } = args;
    const settings = transcribeSettings(args);

    // --force re-runs a billed transcription, so it must not also pick targets:
    // both resolutions error instead of prompting.
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

    // Text runs see the cost before the request; json output stays machine-clean.
    if (output !== "json") logger.warn(TRANSCRIBE_BILLING_NOTE);

    const status = await withSpinner("Queueing transcription...", () =>
      transcribeVideo(client, libraryId, video.guid, settings, { force }),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: video.guid,
            title: video.title,
            queued: true,
            force: Boolean(force),
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
      "Once it finishes, the Captions row of `bunny stream video show` lists the new languages.",
    );
  },
});
