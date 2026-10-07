import { UserError } from "@/core/errors.ts";
import type { VideoModel } from "./videos-api.ts";

/** Captions made by Bunny's transcription are labelled `<code>-auto`, e.g. `en-auto`. */
export const AUTO_CAPTION_SUFFIX = "-auto";

export const AUTO_CAPTION_HINT =
  "Captions made by transcription are labelled <code>-auto, e.g. en-auto; uploaded caption files use the plain code, e.g. en.";

/** The video's caption track codes (`srclang`), in the API's order, deduplicated. */
export function captionLanguages(
  video: Pick<VideoModel, "captions">,
): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const caption of video.captions ?? []) {
    const code = caption.srclang?.trim();
    if (!code || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    codes.push(code);
  }
  return codes;
}

function isAuto(code: string): boolean {
  return code.toLowerCase().endsWith(AUTO_CAPTION_SUFFIX);
}

/** Which caption track smart generation should read, or the tracks to choose between. */
export type SmartSource =
  | {
      language: string;
      /** How it was picked: as asked, swapped to its -auto/plain twin, the only track, or the one -auto track. */
      reason: "exact" | "matched" | "only" | "auto";
    }
  | { choose: string[] };

/**
 * Map `--source-language` onto a caption track the video actually has.
 *
 * The API matches `sourceLanguage` against caption codes exactly, and the
 * tracks transcription makes are `en-auto`, not `en`. So `en` falls back to
 * `en-auto` when only that exists (and `en-auto` to `en`). Without a request,
 * a single track or a single `-auto` transcript is picked; otherwise the
 * caller asks, rather than letting the API take the first track.
 */
export function resolveSmartSource(
  captions: readonly string[],
  requested?: string | null,
): SmartSource {
  const byLower = new Map(captions.map((code) => [code.toLowerCase(), code]));
  const wanted = requested?.trim().toLowerCase();

  if (wanted) {
    const exact = byLower.get(wanted);
    if (exact) return { language: exact, reason: "exact" };
    const twin = isAuto(wanted)
      ? wanted.slice(0, -AUTO_CAPTION_SUFFIX.length)
      : `${wanted}${AUTO_CAPTION_SUFFIX}`;
    const matched = byLower.get(twin);
    if (matched) return { language: matched, reason: "matched" };
    throw new UserError(
      `This video has no ${requested?.trim()} captions.`,
      `Available: ${captions.join(", ") || "none"}. ${AUTO_CAPTION_HINT}`,
    );
  }

  if (captions.length === 1) {
    return { language: captions[0] as string, reason: "only" };
  }
  const autos = captions.filter(isAuto);
  if (autos.length === 1)
    return { language: autos[0] as string, reason: "auto" };
  return { choose: autos.length > 1 ? autos : [...captions] };
}

/**
 * The spoken language for a transcription. `--source-language en-auto` names a
 * caption track, so the suffix is dropped when the video has no captions yet
 * and the value is used to transcribe instead.
 */
export function spokenLanguage(source: string | undefined): string | undefined {
  const code = source?.trim();
  if (!code) return undefined;
  return isAuto(code) ? code.slice(0, -AUTO_CAPTION_SUFFIX.length) : code;
}
