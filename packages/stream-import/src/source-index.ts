import type { BunnyVideo } from "./bunny-types.ts";
import { BunnyVideoStatus } from "./bunny-types.ts";

/** What a tagged Bunny video means for the import: done, still Bunny's problem, or Bunny gave up. */
export type BunnyVideoHealth = "finished" | "processing" | "failed";

export function videoHealth(video: BunnyVideo): BunnyVideoHealth {
  switch (video.status) {
    case BunnyVideoStatus.Finished:
    case BunnyVideoStatus.JitPlaylistsCreated:
      return "finished";
    case BunnyVideoStatus.Error:
    case BunnyVideoStatus.UploadFailed:
      return "failed";
    default:
      return "processing";
  }
}

/** `Severity.Error` in the Stream spec: the video will most likely not play. */
const TRANSCODING_ERROR_LEVEL = 3;

/** Why Bunny gave up on a video, with its own error-level transcoding messages when it gave any. */
export function failureReason(video: BunnyVideo): string {
  const generic =
    video.status === BunnyVideoStatus.UploadFailed
      ? "Bunny could not fetch the file from the source"
      : "Bunny could not encode the video";
  const messages = (video.transcodingMessages ?? [])
    .filter((m) => m.level === TRANSCODING_ERROR_LEVEL && m.message)
    .map((m) => m.message);

  return messages.length > 0 ? `${generic}: ${messages.join("; ")}` : generic;
}

const HEALTH_RANK: Record<BunnyVideoHealth, number> = {
  finished: 0,
  processing: 1,
  failed: 2,
};

/**
 * Index existing Bunny videos by their source dedup metaTag.
 *
 * This is the primitive the whole "do not import the same video twice"
 * behaviour rests on, so it is deliberately pure and separately tested.
 *
 * When two Bunny videos carry the same tag value the healthiest one wins, and
 * among equals the first: a re-import after a failed fetch leaves the dead copy
 * behind, and it must not shadow the working one on the next run.
 */
export function buildSourceIndex(
  videos: BunnyVideo[],
  tagProperty: string,
): Map<string, BunnyVideo> {
  const index = new Map<string, BunnyVideo>();

  for (const video of videos) {
    const tag = video.metaTags?.find((t) => t.property === tagProperty);
    if (!tag?.value) continue;
    const current = index.get(tag.value);
    if (
      !current ||
      HEALTH_RANK[videoHealth(video)] < HEALTH_RANK[videoHealth(current)]
    ) {
      index.set(tag.value, video);
    }
  }

  return index;
}
