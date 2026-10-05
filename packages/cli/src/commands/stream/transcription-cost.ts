/**
 * Transcription cost estimates, shared by every command that can trigger a
 * transcription (`stream smart` today; `stream transcribe` and
 * `stream encode reencode` can reuse it).
 *
 * Billing is per output language-minute: each output caption language costs
 * $0.10 per minute of audio, and the source-language transcript is free.
 */

/** Price per output language per minute of audio, in US dollars. */
export const TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE = 0.1;

export interface TranscriptionEstimate {
  /** Billable minutes (rounded up), or undefined when the length isn't known yet. */
  minutes?: number;
  /** Output languages that will be billed, deduplicated, in the order given. */
  languages: string[];
  /** Estimated cost in US dollars, or undefined when the length isn't known yet. */
  cost?: number;
}

/**
 * The output languages a transcription will produce: the ones asked for, or the
 * library's defaults when none were asked for. Deduplicated case-insensitively.
 */
export function outputLanguages(
  requested: readonly string[] | null | undefined,
  libraryDefaults: readonly string[] | null | undefined,
): string[] {
  const source =
    requested && requested.length > 0 ? requested : (libraryDefaults ?? []);
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const raw of source) {
    const language = raw.trim().toLowerCase();
    if (!language || seen.has(language)) continue;
    seen.add(language);
    languages.push(language);
  }
  return languages;
}

/** estimate = minutes × output languages × $0.10, with minutes rounded up. */
export function estimateTranscription(
  lengthSeconds: number | null | undefined,
  languages: readonly string[],
): TranscriptionEstimate {
  const list = [...languages];
  if (list.length === 0)
    return { minutes: undefined, languages: list, cost: 0 };
  if (!lengthSeconds || lengthSeconds <= 0) return { languages: list };

  const minutes = Math.ceil(lengthSeconds / 60);
  // Work in cents so the total never picks up floating-point noise.
  const cents =
    minutes *
    list.length *
    Math.round(TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE * 100);
  return { minutes, languages: list, cost: cents / 100 };
}

/** One human line describing the estimate, for prompts and errors. */
export function formatTranscriptionEstimate(
  estimate: TranscriptionEstimate,
): string {
  const { languages, minutes, cost } = estimate;
  if (languages.length === 0) {
    return "Source-language captions only — no charge.";
  }
  const count = `${languages.length} output language${languages.length === 1 ? "" : "s"} (${languages.join(", ")})`;
  if (minutes === undefined || cost === undefined) {
    return `Billed at $${TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE.toFixed(2)} per output language-minute for ${count}; the video's length isn't known yet.`;
  }
  return `About $${cost.toFixed(2)} for ${count} on a ${minutes} min video ($${TRANSCRIBE_RATE_PER_LANGUAGE_MINUTE.toFixed(2)} per output language-minute).`;
}
