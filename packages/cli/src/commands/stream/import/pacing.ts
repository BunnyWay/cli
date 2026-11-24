import type { ImportPacing } from "@/tools/stream/index.ts";

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
  pacing: { delay: number; finalDelay: number },
): string {
  const exhausted = rejected.some((f) => !f.retryable);
  const { delay } = retryPacing(slowestPace(pacing));
  return `${exhausted ? " --clean-failed" : ""} --concurrency 1 --delay ${delay}`;
}

/** The slowest pace a run reached: its own gap, or the wider one it slowed itself down to. */
export function slowestPace(pacing: { delay: number; finalDelay: number }): {
  delay: number;
} {
  return { delay: Math.max(pacing.delay, pacing.finalDelay) };
}
