/**
 * Refresh a saved run against Bunny. Needs no source credentials: everything
 * a host wants to show about progress lives on the Bunny videos the run
 * created, so this is what a status command calls.
 */

import type { BunnyStream } from "./bunny-stream.ts";
import type { BunnyVideo } from "./bunny-types.ts";
import type { MigrationState } from "./contracts.ts";
import { videoHealth } from "./source-index.ts";

export interface RefreshedMigration {
  state: MigrationState;
  /** The live Bunny record for every entry that has one, by GUID. */
  videos: Map<string, BunnyVideo>;
}

/** Pull each queued entry's Bunny status into the state; the caller decides whether to save it. */
export async function refreshMigrationState(
  state: MigrationState,
  bunny: BunnyStream,
): Promise<RefreshedMigration> {
  const byGuid = new Map<string, BunnyVideo>();
  for (const video of await bunny.listVideos()) {
    if (video.guid) byGuid.set(video.guid, video);
  }

  const videos = new Map<string, BunnyVideo>();
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
      default:
        if (entry.status === "completed") break;
        entry.status = "processing";
    }
  }

  const statuses = state.videoMigrations.map((m) => m.status);
  state.status = statuses.includes("failed")
    ? "failed"
    : statuses.some((s) => s !== "completed")
      ? "in_progress"
      : "completed";
  state.updatedAt = new Date().toISOString();

  return { state, videos };
}
