/**
 * What a fresh deploy is asked before the command calls it a success.
 *
 * A green line printed above a URL that does not serve is the worst thing a
 * deploy can do. Two faults have happened for real, so two things are checked:
 * a script that will not start, and a site answering a miss with bunny.net's
 * error page rather than its own.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** How many times to ask a fresh deploy before believing the answer. */
const HEALTH_ATTEMPTS = 3;
const HEALTH_INTERVAL_MS = 3000;

/** Overridden by the test, which has no nine seconds to spare. */
export const health = {
  wait: (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Ask the site for its home page, and answer with a status that means it is down.
 *
 * Returns null when the site answered anything a working script can answer, a
 * redirect and a 404 included, and when it could not be reached at all. A deploy
 * that prints a green line above a URL answering 400 is the worst thing this
 * command can do, and the script's own size is the usual reason.
 */
export async function findDeployFault(
  url: string,
  deployId: string,
): Promise<number | null> {
  let fault: number | null = null;
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
    if (attempt > 0) await health.wait(HEALTH_INTERVAL_MS);
    try {
      // A unique query per attempt keeps the probe out of the CDN cache, so a
      // cached failure cannot outlive the release that caused it.
      const response = await fetch(
        `${url}/?__bunny_check=${deployId}-${attempt}`,
        {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.status !== 400 && response.status < 500) return null;
      fault = response.status;
    } catch {
      // Unreachable is not a verdict: DNS and TLS take their own time.
      return fault;
    }
  }
  return fault;
}

/** The names a deploy's own error page is written under. Both hosts read the first. */
const NOT_FOUND_FILES = ["404.html", "404/index.html"];

/**
 * The deploy's own 404 page, or null when it has none.
 *
 * `files` is what the deploy uploaded, so this asks the build what it produced
 * rather than guessing from a framework.
 */
export async function readNotFoundPage(
  dir: string,
  files: Array<{ path: string }>,
): Promise<string | null> {
  const name = NOT_FOUND_FILES.find((candidate) =>
    files.some((file) => file.path === candidate),
  );
  if (!name) return null;
  try {
    // A deploy path is POSIX, whatever the machine that built it.
    return await readFile(join(dir, ...name.split("/")), "utf8");
  } catch {
    return null;
  }
}

/**
 * Ask for a path the deploy cannot hold, and check the deploy's own page
 * answers it.
 *
 * A pull zone with no error page of its own answers a miss with bunny.net's,
 * whatever the build produced. That shipped: a documentation site went up and
 * every wrong URL showed bunny.net's page instead of the site's. Nothing in the
 * API reports it, and nobody reads a 404 on the happy path, so it is asked for
 * here.
 *
 * The probe is a path, not a query string: a sites pull zone ignores query
 * strings, so `?x=1` is the same URL to the cache. Returns the status that
 * answered when the page was not the deploy's, and null when it was, when the
 * deploy has no page of its own, or when the site could not be reached.
 */
export async function findMissingPageFault(opts: {
  url: string;
  deployId: string;
  /** The deploy's own 404 page, from {@link readNotFoundPage}. */
  page: string | null;
}): Promise<number | null> {
  if (opts.page === null) return null;
  const wanted = opts.page.trim();
  let fault: number | null = null;
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
    if (attempt > 0) await health.wait(HEALTH_INTERVAL_MS);
    try {
      const response = await fetch(
        `${opts.url}/_bunny_check/${opts.deployId}/${attempt}`,
        { redirect: "manual", signal: AbortSignal.timeout(10_000) },
      );
      const body = await response.text();
      if (response.status === 404 && body.trim() === wanted) return null;
      fault = response.status;
    } catch {
      // Unreachable is not a verdict: DNS and TLS take their own time.
      return null;
    }
  }
  return fault;
}
