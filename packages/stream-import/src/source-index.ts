import type { BunnyVideo } from "./bunny-types.ts";

/**
 * Index existing Bunny videos by their source dedup metaTag.
 *
 * This is the primitive the whole "do not import the same video twice"
 * behaviour rests on, so it is deliberately pure and separately tested.
 *
 * When two Bunny videos carry the same tag value the first one wins: re-running
 * an import should not start reassigning already-linked videos just because a
 * duplicate exists upstream.
 */
export function buildSourceIndex(
  videos: BunnyVideo[],
  tagProperty: string,
): Map<string, BunnyVideo> {
  const index = new Map<string, BunnyVideo>();

  for (const video of videos) {
    const tag = video.metaTags?.find((t) => t.property === tagProperty);
    if (!tag?.value) continue;
    if (!index.has(tag.value)) index.set(tag.value, video);
  }

  return index;
}
