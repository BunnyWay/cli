import type { BunnyVideo } from "./bunny-types.ts";
import { BunnyVideoStatus } from "./bunny-types.ts";

/** What a tagged Bunny video means for the import: done, still Bunny's problem, or Bunny gave up. */
export type BunnyVideoHealth = "finished" | "processing" | "failed";

export function videoHealth(video: BunnyVideo): BunnyVideoHealth {
  switch (video.status) {
    case BunnyVideoStatus.Finished:
      return "finished";
    case BunnyVideoStatus.Error:
    case BunnyVideoStatus.UploadFailed:
      return "failed";
    default:
      return "processing";
  }
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
