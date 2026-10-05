/** Reconciling a saved import with what Bunny has done since the handoff: finished, failed, or vanished. */

import type { BunnyStream } from "./bunny-stream.ts";
import type { BunnyVideo } from "./bunny-types.ts";
import { BunnyVideoStatus, isFailedVideoStatus } from "./bunny-types.ts";
import type { MigrationState, MigrationStatus } from "./contracts.ts";

/** `completed` only once every video is encoded; anything failed keeps the run resumable. */
export function settledStatus(state: MigrationState): MigrationStatus {
  const statuses = state.videoMigrations.map((m) => m.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.every((s) => s === "completed")) return "completed";

  return "in_progress";
}

/** Update every handed-over entry from one library listing, in place; returns the listing by video ID for the host to render. */
export async function refreshMigrationState(
  state: MigrationState,
  bunny: Pick<BunnyStream, "listVideos">,
): Promise<Map<string, BunnyVideo>> {
  const tracked = state.videoMigrations.filter(
    (m) => m.bunnyVideoId && m.status === "processing",
  );
  if (!state.videoMigrations.some((m) => m.bunnyVideoId)) return new Map();

  const videos = new Map<string, BunnyVideo>();
  for (const video of await bunny.listVideos()) {
    if (video.guid) videos.set(video.guid, video);
  }

  for (const migration of tracked) {
    const video = videos.get(migration.bunnyVideoId as string);
    if (!video) {
      migration.status = "failed";
      migration.error = "The video was deleted from Bunny before it finished";
      continue;
    }
    migration.encodeProgress = video.encodeProgress ?? migration.encodeProgress;
    if (video.status === BunnyVideoStatus.Finished) {
      migration.status = "completed";
      migration.encodeProgress = 100;
      migration.completedAt = new Date().toISOString();
    } else if (isFailedVideoStatus(video.status)) {
      migration.status = "failed";
      migration.error =
        video.status === BunnyVideoStatus.UploadFailed
          ? "Bunny could not fetch the file from the source"
          : "Bunny could not encode the video";
    }
  }

  state.status = settledStatus(state);
  state.updatedAt = new Date().toISOString();

  return videos;
}
