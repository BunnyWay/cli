import {
  DEFAULT_CONCURRENCY,
  DEFAULT_REQUEST_TIMEOUT,
  type LargeLibraryProfile,
  largeLibraryProfile,
  type SourcePlugin,
} from "@bunny.net/stream-import";

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

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** What to tell the user about a large import's pacing; empty when no profile applies. */
export function pacingNotice(
  pacing: ImportPacing,
  videoCount: number,
): { warn: string[]; info: string[] } {
  if (!pacing.profile) return { warn: [], info: [] };
  const count = videoCount.toLocaleString("en-US");
  const recommended = `--concurrency ${pacing.profile.concurrency} --delay ${pacing.profile.intervalSeconds} --request-timeout ${pacing.profile.requestTimeoutSeconds}`;
  const warn = [
    pacing.applied.length > 0
      ? `Large library detected (${count} videos to import). To keep it reliable, this import is paced with: ${pacing.applied.join(" ")}`
      : `Large library detected (${count} videos to import). Recommended settings: ${recommended}`,
  ];
  for (const r of pacing.riskier) {
    warn.push(
      r.flag === "request-timeout"
        ? `--request-timeout ${r.value} is below the recommended ${r.recommended}; slow responses may time out.`
        : `--${r.flag} ${r.value} is ${r.flag === "delay" ? "below" : "above"} the recommended ${r.recommended}; videos may fail to import (the import then slows down by itself).`,
    );
  }
  const info: string[] = [];
  if (pacing.delay > 0)
    info.push(
      `At one new video every ${pacing.delay}s, handing ${count} videos to Bunny takes about ${duration(videoCount * pacing.delay)}. Stop at any time and continue with --resume.`,
    );
  return { warn, info };
}

/** The pace for retrying after fetches failed with HTTP 422/503: one at a time, at least 30s apart, and at least twice the last gap. */
export function retryPacing(previous: { delay?: number }): {
  concurrency: number;
  delay: number;
} {
  return {
    concurrency: 1,
    delay: Math.min(Math.max((previous.delay ?? 0) * 2, 30), 600),
  };
}

/**
 * The flags to resume more slowly after fetches failed with HTTP 422/503. A
 * plain resume skips entries that used up their attempts (not `retryable`),
 * so `--clean-failed` comes along when any of them did.
 */
export function slowResumeFlags(
  rejected: ReadonlyArray<{ retryable: boolean }>,
): string {
  const exhausted = rejected.some((f) => !f.retryable);
  return `${exhausted ? " --clean-failed" : ""} --concurrency 1 --delay 30`;
}
