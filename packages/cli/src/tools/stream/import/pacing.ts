import {
  DEFAULT_CONCURRENCY,
  DEFAULT_REQUEST_TIMEOUT,
  type LargeLibraryProfile,
  largeLibraryProfile,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import type { ImportSummary } from "./model.ts";

export interface PacingFlags {
  concurrency?: number;
  delay?: number;
  requestTimeout?: number;
}

/** The settings an import runs with. */
export interface ImportPacing {
  concurrency: number;
  /** Seconds between starting two hand-offs. */
  delay: number;
  requestTimeout: number;
  /** Set when the source's large-library profile applies to this many videos. */
  profile?: LargeLibraryProfile;
}

/** Passed flags win; otherwise a large import takes the source's large-library profile, and anything else the usual defaults. */
export function importPacing(
  plugin: Pick<SourcePlugin, "largeLibrary">,
  videoCount: number,
  flags: PacingFlags,
): ImportPacing {
  const profile = largeLibraryProfile(plugin, videoCount);
  return {
    concurrency:
      flags.concurrency ?? profile?.concurrency ?? DEFAULT_CONCURRENCY,
    delay: flags.delay ?? profile?.intervalSeconds ?? 0,
    requestTimeout:
      flags.requestTimeout ??
      Math.max(
        profile?.requestTimeoutSeconds ?? 0,
        DEFAULT_REQUEST_TIMEOUT / 1000,
      ),
    profile,
  };
}

/** The video count a large-library profile is judged by: a resume counts the whole import, so its tail keeps the pace. */
export function importSize(
  summary: Pick<
    ImportSummary,
    "newVideos" | "alreadyMigrated" | "processingOnBunny"
  >,
  resume?: boolean,
): number {
  return resume
    ? summary.newVideos + summary.alreadyMigrated + summary.processingOnBunny
    : summary.newVideos;
}

/** The pace as plans and runs report it. */
export function pacingSummary(pacing: ImportPacing) {
  return {
    concurrency: pacing.concurrency,
    delay: pacing.delay,
    requestTimeout: pacing.requestTimeout,
    largeLibrary: Boolean(pacing.profile),
  };
}
