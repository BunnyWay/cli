import { UserError } from "@/core/errors.ts";
import { confirm, isInteractive } from "@/core/ui.ts";
import type { VideoLibraryModel } from "./api.ts";
import {
  estimateTranscription,
  formatTranscriptionEstimate,
  outputLanguages,
  type TranscriptionEstimate,
} from "./transcription-cost.ts";
import type {
  SmartGenerateModel,
  TranscribeSettings,
  VideoModel,
} from "./videos-api.ts";

/** Whether the video already has a transcript that smart generation can read. */
export function hasCaptions(video: VideoModel): boolean {
  return (video.captions ?? []).length > 0;
}

/**
 * The transcribe body that stands in for a smart generation on a captionless
 * video: transcribing with the same generate flags produces the same fields
 * from the new transcript, so no second request is needed.
 *
 * Target languages are left out on purpose, so the library's defaults apply,
 * which is what the estimate is based on.
 */
export function transcribeSettingsForSmart(
  body: SmartGenerateModel,
): TranscribeSettings {
  const settings: TranscribeSettings = {};
  if (body.generateTitle) settings.generateTitle = true;
  if (body.generateDescription) settings.generateDescription = true;
  if (body.generateChapters) settings.generateChapters = true;
  if (body.generateMoments) settings.generateMoments = true;
  if (body.sourceLanguage) settings.sourceLanguage = body.sourceLanguage;
  return settings;
}

/** What transcribing this video now would cost: the source transcript plus the library's default languages. */
export function smartTranscriptionEstimate(
  video: VideoModel,
  library: Pick<VideoLibraryModel, "TranscribingCaptionLanguages">,
  sourceLanguage?: string | null,
): TranscriptionEstimate {
  return estimateTranscription(
    video.length,
    outputLanguages(undefined, library.TranscribingCaptionLanguages),
    sourceLanguage,
  );
}

/** The error an unattended run gets: there's nobody to approve the cost. */
export function captionlessError(
  video: VideoModel,
  estimate: TranscriptionEstimate,
): UserError {
  return new UserError(
    `${video.title} has no captions, and smart generation needs a transcript. ${formatTranscriptionEstimate(estimate)}`,
    `Re-run with --transcribe to transcribe it first, or add captions with "bunny stream caption add".`,
  );
}

/**
 * Offer to transcribe a captionless video before smart generation.
 *
 * Returns the transcribe settings to send, or `null` when the user declines.
 * Never transcribes silently: `--transcribe` pre-approves it, an interactive run
 * asks, and an unattended run without `--transcribe` errors with the cost.
 * `--force` does not approve it.
 */
export async function offerTranscription(
  video: VideoModel,
  library: Pick<VideoLibraryModel, "TranscribingCaptionLanguages">,
  body: SmartGenerateModel,
  opts: { output?: string; transcribe?: boolean },
): Promise<TranscribeSettings | null> {
  const settings = transcribeSettingsForSmart(body);
  if (opts.transcribe) return settings;

  const estimate = smartTranscriptionEstimate(
    video,
    library,
    body.sourceLanguage,
  );
  if (!isInteractive(opts.output)) throw captionlessError(video, estimate);

  const approved = await confirm(
    `${video.title} has no captions, and smart generation needs a transcript. ${formatTranscriptionEstimate(estimate)} Transcribe it now?`,
    { initial: false, optional: true },
  );
  return approved ? settings : null;
}
