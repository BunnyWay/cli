import type { ImportPacing, PacingFlags } from "@/tools/stream/index.ts";

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
  flags: PacingFlags,
  videoCount: number,
): { warn: string[]; info: string[] } {
  const { profile } = pacing;
  if (!profile) return { warn: [], info: [] };
  const count = videoCount.toLocaleString("en-US");
  const settings = [
    {
      flag: "concurrency",
      passed: flags.concurrency,
      recommended: profile.concurrency,
    },
    {
      flag: "delay",
      passed: flags.delay,
      recommended: profile.intervalSeconds,
    },
    {
      flag: "request-timeout",
      passed: flags.requestTimeout,
      recommended: profile.requestTimeoutSeconds,
    },
  ];
  const asFlags = (list: typeof settings) =>
    list.map((s) => `--${s.flag} ${s.recommended}`).join(" ");
  const applied = settings.filter((s) => s.passed === undefined);
  const warn = [
    applied.length > 0
      ? `Large library detected (${count} videos to import). To keep it reliable, this import is paced with: ${asFlags(applied)}`
      : `Large library detected (${count} videos to import). Recommended settings: ${asFlags(settings)}`,
  ];
  for (const { flag, passed, recommended } of settings) {
    if (passed === undefined) continue;
    if (flag === "concurrency" ? passed <= recommended : passed >= recommended)
      continue;
    warn.push(
      flag === "request-timeout"
        ? `--request-timeout ${passed} is below the recommended ${recommended}; slow responses may time out.`
        : `--${flag} ${passed} is ${flag === "delay" ? "below" : "above"} the recommended ${recommended}; videos may fail to import (the import then slows down by itself).`,
    );
  }
  const info: string[] = [];
  if (pacing.delay > 0)
    info.push(
      `At one new video every ${pacing.delay}s, handing ${count} videos to Bunny takes about ${duration(videoCount * pacing.delay)}. Stop at any time and continue with --resume.`,
    );
  return { warn, info };
}

/** The pace for retrying after fetches failed with HTTP 422/503: one at a time, at least 30s apart, and twice the slowest gap the run reached. */
export function retryPacing(pacing: { delay: number; finalDelay: number }): {
  concurrency: number;
  delay: number;
} {
  const slowest = Math.max(pacing.delay, pacing.finalDelay);
  return { concurrency: 1, delay: Math.min(Math.max(slowest * 2, 30), 600) };
}

/** The flags to resume more slowly; `--clean-failed` comes along when a failure used up its attempts, which a plain resume skips. */
export function slowResumeFlags(
  rejected: ReadonlyArray<{ retryable: boolean }>,
  pacing: { delay: number; finalDelay: number },
): string {
  const exhausted = rejected.some((f) => !f.retryable);
  return `${exhausted ? " --clean-failed" : ""} --concurrency 1 --delay ${retryPacing(pacing).delay}`;
}
