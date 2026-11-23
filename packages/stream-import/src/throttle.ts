/**
 * Pacing for imports.
 *
 * Bunny fetches every video straight from the source. When Bunny's fetch
 * fails with HTTP 422 or 503 partway through a big import, handing videos
 * over more slowly usually gets past it. Two levers:
 *
 * - a profile on the source plugin (`largeLibrary`) that a host applies to a
 *   big import up front: lower concurrency, a gap between hand-offs, a longer
 *   request timeout;
 * - the `Pacer`, which spaces out hand-offs and backs off by itself when
 *   those failures start mid-run.
 */

import type { LargeLibraryProfile, SourcePlugin } from "./contracts.ts";
import { sleep } from "./time.ts";

/** Statuses from Bunny's fetch endpoint that a slower retry usually gets past. */
export const SOURCE_REJECTION_STATUSES: ReadonlySet<number> = new Set([
  422, 503,
]);

/** The gap the pacer backs off to on the first rejection, and the most it will wait between hand-offs. */
export const MIN_BACKOFF_INTERVAL_MS = 15_000;
export const MAX_BACKOFF_INTERVAL_MS = 120_000;

/** The error recorded on a video whose fetch failed with one of those statuses. */
export const SOURCE_REJECTED_MESSAGE =
  "Import failed, try slowing down the import using delay or concurrency";

/**
 * Thrown for a fetch that failed with one of those statuses, so the run can slow down and the
 * host can tell these failures apart. The HTTP status is kept on the error
 * (and the entry is marked `sourceRejected`), not in the message.
 */
export class SourceRejectedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(SOURCE_REJECTED_MESSAGE);
    this.name = "SourceRejectedError";
    this.status = status;
  }
}

/** The large-library profile to apply, when the source has one and `videoCount` is over its threshold. */
export function largeLibraryProfile(
  plugin: Pick<SourcePlugin, "largeLibrary">,
  videoCount: number,
): LargeLibraryProfile | undefined {
  const profile = plugin.largeLibrary;
  return profile && videoCount > profile.threshold ? profile : undefined;
}

/**
 * Spaces out the start of each hand-off across all workers, so `intervalMs`
 * caps the rate however many run in parallel. `backoff()` doubles the gap
 * (from at least 15s, up to 2 minutes) and reports the new one.
 */
export class Pacer {
  private next = 0;

  constructor(
    private intervalMs: number,
    private readonly wait: (
      ms: number,
      signal?: AbortSignal,
    ) => Promise<void> = sleep,
    private readonly now: () => number = Date.now,
  ) {}

  get interval(): number {
    return this.intervalMs;
  }

  /** Waits for this caller's slot; slots are handed out in call order. */
  async turn(signal?: AbortSignal): Promise<void> {
    if (this.intervalMs <= 0) return;
    const now = this.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await this.wait(at - now, signal);
  }

  /** Slow down after a rejection. Returns the new gap, or undefined when already at the ceiling. */
  backoff(): number | undefined {
    const slower = Math.min(
      Math.max(this.intervalMs * 2, MIN_BACKOFF_INTERVAL_MS),
      MAX_BACKOFF_INTERVAL_MS,
    );
    if (slower <= this.intervalMs) return undefined;
    this.intervalMs = slower;
    // Push queued slots out too, so the next hand-off already observes the new gap.
    this.next = Math.max(this.next, this.now() + slower);
    return slower;
  }
}
