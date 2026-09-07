import type { Argv } from "yargs";
import type { VideoLibraryUpdateModel } from "@/commands/stream/api.ts";
import { UserError } from "@/core/errors.ts";

/**
 * Encoding and transcribing flags, shared by `library create` and `library update`.
 *
 * Both models carry the same field names for these settings, so one parser and
 * one builder serve both commands.
 */
export interface LibrarySettingsArgs {
  name?: string;
  encodingTier?: string;
  jit?: boolean;
  codecs?: string;
  resolutions?: string;
  transcribing?: boolean;
  transcribingLanguages?: string;
  transcribingTitle?: boolean;
  transcribingDescription?: boolean;
  transcribingChapters?: boolean;
  transcribingMoments?: boolean;
}

/**
 * The fields both VideoLibraryCreateModel and VideoLibraryUpdateModel share.
 *
 * Taken from the update model, where every field including Name is optional;
 * create requires Name, which that command sets itself from its positional.
 */
export type LibrarySettings = Pick<
  VideoLibraryUpdateModel,
  | "Name"
  | "EncodingTier"
  | "JitEncodingEnabled"
  | "OutputCodecs"
  | "EnabledResolutions"
  | "EnableTranscribing"
  | "TranscribingCaptionLanguages"
  | "EnableTranscribingTitleGeneration"
  | "EnableTranscribingDescriptionGeneration"
  | "EnableTranscribingChaptersGeneration"
  | "EnableTranscribingMomentsGeneration"
>;

// EncodingTier is an integer enum in the core spec: 0 = Free, 1 = Premium.
const ENCODING_TIERS: Record<string, 0 | 1> = { free: 0, premium: 1 };
export const ENCODING_TIER_CHOICES = Object.keys(ENCODING_TIERS);

/** Codecs the API documents for OutputCodecs; vp9, hevc, and av1 need premium. */
export const CODEC_CHOICES = ["x264", "vp9", "hevc", "av1"] as const;

/** Resolutions the API documents for EnabledResolutions. */
export const RESOLUTION_CHOICES = [
  "240p",
  "360p",
  "480p",
  "720p",
  "1080p",
  "1440p",
  "2160p",
] as const;

export function encodingTierValue(value: string): 0 | 1 {
  const tier = ENCODING_TIERS[value.trim().toLowerCase()];
  if (tier === undefined) {
    throw new UserError(
      `Invalid --encoding-tier "${value}".`,
      `Valid values: ${ENCODING_TIER_CHOICES.join(", ")}.`,
    );
  }
  return tier;
}

/** Split a comma-separated flag value into trimmed, non-empty entries. */
export function parseCsvFlag(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Validate a CSV flag against a fixed set, preserving the caller's order. */
export function parseChoiceCsv(
  flag: string,
  value: string,
  choices: readonly string[],
  opts: { lowercase?: boolean } = {},
): string[] {
  const entries = parseCsvFlag(value).map((entry) =>
    opts.lowercase === false ? entry : entry.toLowerCase(),
  );
  if (entries.length === 0) {
    throw new UserError(
      `--${flag} needs at least one value.`,
      `Valid values: ${choices.join(", ")}.`,
    );
  }
  const invalid = entries.filter((entry) => !choices.includes(entry));
  if (invalid.length > 0) {
    throw new UserError(
      `Invalid --${flag} value(s): ${invalid.join(", ")}.`,
      `Valid values: ${choices.join(", ")}.`,
    );
  }
  return [...new Set(entries)];
}

/** Whether any encoding/transcribing flag was provided. */
export function hasLibrarySettingsFlags(args: LibrarySettingsArgs): boolean {
  return (
    args.encodingTier !== undefined ||
    args.jit !== undefined ||
    args.codecs !== undefined ||
    args.resolutions !== undefined ||
    args.transcribing !== undefined ||
    args.transcribingLanguages !== undefined ||
    args.transcribingTitle !== undefined ||
    args.transcribingDescription !== undefined ||
    args.transcribingChapters !== undefined ||
    args.transcribingMoments !== undefined
  );
}

/**
 * Build a sparse settings body: only the fields whose flags were provided.
 *
 * Anything left out of the body is left untouched by the API, so an update never
 * rewrites a setting the user did not mention.
 */
export function librarySettingsFromFlags(
  args: LibrarySettingsArgs,
): LibrarySettings {
  const settings: LibrarySettings = {};

  const name = args.name?.trim();
  if (name) settings.Name = name;

  if (args.encodingTier !== undefined)
    settings.EncodingTier = encodingTierValue(args.encodingTier);
  if (args.jit !== undefined) settings.JitEncodingEnabled = args.jit;
  if (args.codecs !== undefined) {
    settings.OutputCodecs = parseChoiceCsv(
      "codecs",
      args.codecs,
      CODEC_CHOICES,
    ).join(",");
  }
  if (args.resolutions !== undefined) {
    settings.EnabledResolutions = parseChoiceCsv(
      "resolutions",
      args.resolutions,
      RESOLUTION_CHOICES,
    ).join(",");
  }

  if (args.transcribing !== undefined)
    settings.EnableTranscribing = args.transcribing;
  if (args.transcribingLanguages !== undefined) {
    // TranscribingCaptionLanguages is an array in the spec, not a CSV string.
    const languages = parseCsvFlag(args.transcribingLanguages);
    if (languages.length === 0) {
      throw new UserError(
        "--transcribing-languages needs at least one language.",
        "Pass ISO 639-1 codes, e.g. --transcribing-languages en,de.",
      );
    }
    settings.TranscribingCaptionLanguages = languages;
  }
  if (args.transcribingTitle !== undefined)
    settings.EnableTranscribingTitleGeneration = args.transcribingTitle;
  if (args.transcribingDescription !== undefined)
    settings.EnableTranscribingDescriptionGeneration =
      args.transcribingDescription;
  if (args.transcribingChapters !== undefined)
    settings.EnableTranscribingChaptersGeneration = args.transcribingChapters;
  if (args.transcribingMoments !== undefined)
    settings.EnableTranscribingMomentsGeneration = args.transcribingMoments;

  return settings;
}

/** Register the shared encoding/transcribing flags on a command's builder. */
export function withLibrarySettingsOptions(yargs: Argv): Argv {
  return yargs
    .option("encoding-tier", {
      type: "string",
      choices: ENCODING_TIER_CHOICES,
      describe: "Encoding tier; premium adds JIT encoding and extra codecs",
    })
    .option("jit", {
      type: "boolean",
      describe: "Enable just-in-time encoding (--no-jit disables it)",
    })
    .option("codecs", {
      type: "string",
      describe: `Output codecs, comma-separated: ${CODEC_CHOICES.join(", ")} (vp9, hevc, av1 need premium)`,
    })
    .option("resolutions", {
      type: "string",
      describe: `Enabled resolutions, comma-separated: ${RESOLUTION_CHOICES.join(", ")}`,
    })
    .option("transcribing", {
      type: "boolean",
      describe:
        "Enable automatic transcribing (--no-transcribing disables it); billed per use",
    })
    .option("transcribing-languages", {
      type: "string",
      describe:
        "Caption languages to transcribe to, comma-separated (e.g. en,de)",
    })
    .option("transcribing-title", {
      type: "boolean",
      describe: "Generate the video title from the transcript",
    })
    .option("transcribing-description", {
      type: "boolean",
      describe: "Generate the video description from the transcript",
    })
    .option("transcribing-chapters", {
      type: "boolean",
      describe: "Generate chapters from the transcript",
    })
    .option("transcribing-moments", {
      type: "boolean",
      describe: "Generate moments from the transcript",
    });
}
