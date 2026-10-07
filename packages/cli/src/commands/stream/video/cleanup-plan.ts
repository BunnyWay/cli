import type {
  CleanupResolutionsQuery,
  VideoResolutionsInfoModel,
} from "@/commands/stream/videos-api.ts";

/** One thing a cleanup would delete. */
export interface CleanupItem {
  kind: "hls" | "mp4" | "original";
  /** The resolution, e.g. `720p`; absent for the original. */
  resolution?: string;
  /** Storage path the API reports for it, when it reports one. */
  path?: string;
}

export interface CleanupPlan {
  items: CleanupItem[];
  /** Resolutions named in `--resolutions` that the video doesn't have. */
  notPresent: string[];
}

function byResolution(
  refs: VideoResolutionsInfoModel["playlistResolutions"],
): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const ref of refs ?? []) {
    if (ref.resolution && !map.has(ref.resolution))
      map.set(ref.resolution, ref.path ?? undefined);
  }
  return map;
}

function numeric(a: string, b: string): number {
  return (Number.parseInt(a, 10) || 0) - (Number.parseInt(b, 10) || 0);
}

/**
 * What a cleanup would delete, worked out from the video's resolutions info.
 *
 * The cleanup endpoint's dry run only answers with a status message, so the
 * list comes from `GET .../resolutions` instead. Resolution selectors
 * (`--resolutions`, `--non-configured`, `--all`) apply to the HLS renditions,
 * to the MP4s with `--outputs mp4`, or to both with `--outputs all`;
 * `--mp4` adds every MP4 file and `--original` the stored original.
 */
export function cleanupPlan(
  info: VideoResolutionsInfoModel,
  query: CleanupResolutionsQuery,
): CleanupPlan {
  const hls = byResolution([
    ...(info.playlistResolutions ?? []),
    ...(info.storageResolutions ?? []),
  ]);
  const mp4 = byResolution(info.mp4Resolutions);
  const configured = new Set(info.configuredResolutions ?? []);
  const outputs = query.outputs ?? "hls";
  const inHls = outputs === "hls" || outputs === "all";
  const inMp4 = outputs === "mp4" || outputs === "all";

  // Every resolution the selected outputs actually hold.
  const present = new Set<string>([
    ...(inHls ? hls.keys() : []),
    ...(inMp4 ? mp4.keys() : []),
  ]);

  const selected = new Set<string>();
  const notPresent: string[] = [];
  if (query.allResolutions) for (const r of present) selected.add(r);
  if (query.deleteNonConfiguredResolutions) {
    for (const r of present) if (!configured.has(r)) selected.add(r);
  }
  for (const raw of (query.resolutionsToDelete ?? "").split(",")) {
    const r = raw.trim();
    if (!r) continue;
    if (present.has(r)) selected.add(r);
    else notPresent.push(r);
  }

  const items: CleanupItem[] = [];
  for (const r of [...selected].sort(numeric)) {
    if (inHls && hls.has(r))
      items.push({ kind: "hls", resolution: r, path: hls.get(r) });
  }
  const mp4Selected = new Set<string>(
    query.deleteMp4Files ? mp4.keys() : inMp4 ? selected : [],
  );
  for (const r of [...mp4Selected].sort(numeric)) {
    if (mp4.has(r))
      items.push({ kind: "mp4", resolution: r, path: mp4.get(r) });
  }
  if (query.deleteOriginal && info.hasOriginal)
    items.push({ kind: "original" });

  return { items, notPresent };
}

/** `HLS 240p`, `MP4 720p`, `Original file`. */
export function cleanupItemLabel(item: CleanupItem): string {
  if (item.kind === "original") return "Original file";
  return `${item.kind.toUpperCase()} ${item.resolution}`;
}

/** A status message worth showing, i.e. not just the API's generic success text. */
export function informativeMessage(
  message: string | null | undefined,
): string | undefined {
  const text = message?.trim();
  if (!text || /^(ok|success|successful)\.?$/i.test(text)) return undefined;
  return text;
}
