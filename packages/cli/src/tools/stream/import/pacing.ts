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

/** The settings an import runs with, and how they came about. */
export interface ImportPacing {
  concurrency: number;
  /** Seconds between starting two hand-offs. */
  delay: number;
  requestTimeout: number;
  /** Set when the source's large-library profile applies to this many videos. */
  profile?: LargeLibraryProfile;
  /** Profile values used because the user did not pass the flag, as flags. */
  applied: string[];
  /** Flags the user passed that are more aggressive than the profile recommends. */
  riskier: Array<{ flag: string; value: number; recommended: number }>;
}

/**
 * Flags the user passed win; otherwise a large import from a source that
 * has a large-library profile gets that gentler profile, and anything else
 * the usual defaults.
 */
export function importPacing(
  plugin: Pick<SourcePlugin, "largeLibrary">,
  videoCount: number,
  flags: PacingFlags,
): ImportPacing {
  const profile = largeLibraryProfile(plugin, videoCount);
  const defaultTimeout = DEFAULT_REQUEST_TIMEOUT / 1000;
  const pacing: ImportPacing = {
    concurrency:
      flags.concurrency ?? profile?.concurrency ?? DEFAULT_CONCURRENCY,
    delay: flags.delay ?? profile?.intervalSeconds ?? 0,
    requestTimeout:
      flags.requestTimeout ??
      Math.max(profile?.requestTimeoutSeconds ?? 0, defaultTimeout),
    profile,
    applied: [],
    riskier: [],
  };
  if (!profile) return pacing;

  const check = (
    flag: string,
    passed: number | undefined,
    recommended: number,
    riskierWhen: (passed: number) => boolean,
  ) => {
    if (passed === undefined) pacing.applied.push(`--${flag} ${recommended}`);
    else if (riskierWhen(passed))
      pacing.riskier.push({ flag, value: passed, recommended });
  };
  check(
    "concurrency",
    flags.concurrency,
    profile.concurrency,
    (v) => v > profile.concurrency,
  );
  check(
    "delay",
    flags.delay,
    profile.intervalSeconds,
    (v) => v < profile.intervalSeconds,
  );
  check(
    "request-timeout",
    flags.requestTimeout,
    profile.requestTimeoutSeconds,
    (v) => v < profile.requestTimeoutSeconds,
  );
  return pacing;
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
