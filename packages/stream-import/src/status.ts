/**
 * Refresh a saved run against Bunny. Needs no source credentials: everything
 * a host wants to show about progress lives on the Bunny videos the run
 * created, so this is what a status command calls.
 */

import type { BunnyStream } from "./bunny-stream.ts";
import type { BunnyVideo } from "./bunny-types.ts";
import type { MigrationState } from "./contracts.ts";
import { videoHealth } from "./source-index.ts";

/** Bunny gives no "stuck" signal, so this long at zero bytes is the best proxy for a fetch that silently died. */
export const DEFAULT_STALLED_AFTER_MS = 30 * 60_000;

export interface RefreshOptions {
  stalledAfterMs?: number;
  /** Injected by tests. */
  now?: number;
}

export interface RefreshedMigration {
  state: MigrationState;
  /** The live Bunny record for every entry that has one, by GUID. */
  videos: Map<string, BunnyVideo>;
  /** GUIDs still processing with no bytes after `stalledAfterMs`. A hint for the host, never grounds to re-import. */
  stalled: Set<string>;
}

/** Pull each queued entry's Bunny status into the state; the caller decides whether to save it. */
export async function refreshMigrationState(
  state: MigrationState,
  bunny: BunnyStream,
  options: RefreshOptions = {},
): Promise<RefreshedMigration> {
  const stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
  const now = options.now ?? Date.now();
  const byGuid = new Map<string, BunnyVideo>();
  for (const video of await bunny.listVideos()) {
    if (video.guid) byGuid.set(video.guid, video);
  }

  const videos = new Map<string, BunnyVideo>();
  const stalled = new Set<string>();
  for (const entry of state.videoMigrations) {
    if (!entry.bunnyVideoId) continue;
    const video = byGuid.get(entry.bunnyVideoId);
    if (!video) {
      // Only downgrade: a video that vanished after finishing is still an import that happened.
      if (entry.status !== "completed") {
        entry.status = "failed";
        entry.error = "Video no longer exists in Bunny";
      }
      continue;
    }
    videos.set(entry.bunnyVideoId, video);
    entry.encodeProgress = video.encodeProgress ?? entry.encodeProgress;
    switch (videoHealth(video)) {
      case "finished":
        entry.status = "completed";
        entry.error = null;
        entry.completedAt ??= new Date().toISOString();
        break;
      case "failed":
        entry.status = "failed";
        entry.error ??= "Bunny could not fetch or encode the video";
        break;
      default: {
        if (entry.status === "completed") break;
        entry.status = "processing";
        // Bunny's own creation time is the reference: an entry adopted from the index has no local startedAt.
        const since = video.dateUploaded ?? entry.startedAt;
        if (
          since &&
          (video.storageSize ?? 0) === 0 &&
          now - Date.parse(since) > stalledAfterMs
        ) {
          stalled.add(entry.bunnyVideoId);
        }
      }
    }
  }

  const statuses = state.videoMigrations.map((m) => m.status);
  state.status = statuses.includes("failed")
    ? "failed"
    : statuses.some((s) => s !== "completed")
      ? "in_progress"
      : "completed";
  state.updatedAt = new Date().toISOString();

  return { state, videos, stalled };
}
