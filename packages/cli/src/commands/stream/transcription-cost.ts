/**
 * Transcription cost estimates, shared by every command that can trigger a
 * transcription: `stream transcribe`, `stream smart` (when it offers to
 * transcribe first) and `stream encode reencode` (on a transcribing library).
 *
 * Billing is per language-minute: every caption language produced costs $0.10
 * per minute of audio, and that includes the source-language transcript. The
 * source counts once even when it is also listed as a target.
 */

/** Price per caption language per minute of audio, in US dollars. */
export const TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE = 0.1;

export interface TranscriptionEstimate {
  /** Billable minutes (rounded up), or undefined when the length isn't known yet. */
  minutes?: number;
  /** Languages billed for certain: the source (when known) first, then each target, deduplicated. */
  languages: string[];
  /**
   * True when the spoken language is auto-detected. It is billed too, as one
   * more language, unless it turns out to be one of `languages`.
   */
  sourceDetected: boolean;
  /** Lowest and highest cost in US dollars (equal when the source is known); undefined when the length isn't known yet. */
  cost?: { min: number; max: number };
}

function normalize(languages: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of languages) {
    const language = raw.trim().toLowerCase();
    if (!language || seen.has(language)) continue;
    seen.add(language);
    out.push(language);
  }
  return out;
}

/**
 * The target languages of a transcription: the ones asked for, or the
 * library's defaults when none were asked for. Deduplicated case-insensitively.
 */
export function outputLanguages(
  requested: readonly string[] | null | undefined,
  libraryDefaults: readonly string[] | null | undefined,
): string[] {
  return normalize(
    requested && requested.length > 0 ? requested : (libraryDefaults ?? []),
  );
}

/**
 * estimate = minutes × billed languages × $0.10, with minutes rounded up.
 *
 * Billed languages are the source plus every target, counted once each. When
 * the source is auto-detected it may or may not match a target, so the
 * estimate is a range: targets only, up to targets plus one.
 */
export function estimateTranscription(
  lengthSeconds: number | null | undefined,
  targets: readonly string[],
  sourceLanguage?: string | null,
): TranscriptionEstimate {
  const source = sourceLanguage?.trim().toLowerCase() || undefined;
  const languages = normalize(source ? [source, ...targets] : targets);
  const sourceDetected = !source;
  if (!lengthSeconds || lengthSeconds <= 0) {
    return { languages, sourceDetected };
  }

  const minutes = Math.ceil(lengthSeconds / 60);
  // Work in cents so the totals never pick up floating-point noise.
  const centsPerLanguage =
    minutes * Math.round(TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE * 100);
  // A detected source adds one language unless it matches a target; with no targets it is the only one.
  const minCount = sourceDetected
    ? Math.max(languages.length, 1)
    : languages.length;
  const maxCount = sourceDetected ? languages.length + 1 : languages.length;
  return {
    minutes,
    languages,
    sourceDetected,
    cost: {
      min: (minCount * centsPerLanguage) / 100,
      max: (maxCount * centsPerLanguage) / 100,
    },
  };
}

const RATE = `$${TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE.toFixed(2)} per language-minute`;

function plural(count: number): string {
  return `${count} language${count === 1 ? "" : "s"}`;
}

/** What is being billed, in words. */
function billedLanguages(estimate: TranscriptionEstimate): string {
  const { languages, sourceDetected } = estimate;
  if (!sourceDetected) {
    return `${plural(languages.length)} (${languages.join(", ")}, including the ${languages[0]} source transcript)`;
  }
  if (languages.length === 0) return "the source-language transcript";
  return `${languages.join(", ")} plus the auto-detected source language`;
}

/** One human line describing the estimate, for prompts, notices and errors. */
export function formatTranscriptionEstimate(
  estimate: TranscriptionEstimate,
): string {
  const what = billedLanguages(estimate);
  const { minutes, cost, sourceDetected, languages } = estimate;
  if (minutes === undefined || cost === undefined) {
    return `Billed at ${RATE} for ${what}; the video's length isn't known yet.`;
  }
  const amount =
    cost.min === cost.max
      ? `$${cost.min.toFixed(2)}`
      : `$${cost.min.toFixed(2)}–$${cost.max.toFixed(2)}`;
  const note =
    sourceDetected && languages.length > 0
      ? `; the lower figure applies if the spoken language is one of ${languages.length === 1 ? "them" : "these"}`
      : "";
  return `About ${amount} for ${what} on a ${minutes} min video (${RATE}${note}).`;
}

/** Video statuses before encoding has finished: Created, Uploaded, Processing, Transcoding, and the JIT stages. */
const STILL_ENCODING = new Set([0, 1, 2, 3, 7, 8]);

/**
 * Whether the library will transcribe this video automatically once encoding
 * finishes, which is the case right after an upload or a re-encode. A manual
 * transcription on top of that is billed twice.
 */
export function autoTranscriptionPending(
  library: { EnableTranscribing?: boolean | null },
  video: { status?: number | null },
): boolean {
  return (
    Boolean(library.EnableTranscribing) &&
    video.status !== undefined &&
    video.status !== null &&
    STILL_ENCODING.has(video.status)
  );
}

/** The double-billing warning shared by `transcribe` and `encode reencode`. */
export const DOUBLE_BILLING_NOTE =
  "Don't also run `bunny stream transcribe` on this video while that's pending, or the transcription is billed twice.";
