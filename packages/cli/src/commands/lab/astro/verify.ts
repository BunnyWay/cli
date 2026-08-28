/**
 * What a fresh deploy is asked before the command calls it a success.
 *
 * A green line printed above a URL that does not serve is the worst thing a
 * deploy can do. The script has 500 ms to start and 10 MB to be parsed in, and
 * when it misses that the edge answers 400 with an empty body. Nothing in the
 * API reports it, so the only place a developer can hear it is here.
 */

/** How many times to ask a fresh deploy before believing the answer. */
const ATTEMPTS = 3;
const INTERVAL_MS = 3000;

/** Overridden by the test, which has no nine seconds to spare. */
export const probe = {
  wait: (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Ask the site for its home page, and answer with a status that means it is down.
 *
 * Returns null when the site answered anything a working script can answer, a
 * redirect and a 404 included, and when it could not be reached at all: DNS and
 * TLS take their own time on a new hostname, and "unreachable" is not a verdict.
 */
export async function findServingFault(
  url: string,
  deployId: string,
): Promise<number | null> {
  let fault: number | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await probe.wait(INTERVAL_MS);
    try {
      // A unique query per attempt keeps the probe out of the CDN cache, so a
      // cached failure cannot outlive the release that caused it.
      const response = await fetch(
        `${url}/?__bunny_check=${deployId}-${attempt}`,
        { redirect: "manual", signal: AbortSignal.timeout(10_000) },
      );
      if (response.status !== 400 && response.status < 500) return null;
      fault = response.status;
    } catch {
      return fault;
    }
  }
  return fault;
}

/**
 * Ask for a path the site cannot hold, and check Astro answered it.
 *
 * A pull zone with no error page of its own answers a miss with bunny.net's,
 * whatever the build produced. Astro renders its own 404 route, so a bunny.net
 * page here means the request never reached the script. Returns the status that
 * answered when the body came from bunny.net, and null otherwise.
 */
export async function findMissingPageFault(
  url: string,
  deployId: string,
): Promise<number | null> {
  let fault: number | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await probe.wait(INTERVAL_MS);
    try {
      const response = await fetch(
        `${url}/_bunny_check/${deployId}/${attempt}`,
        { redirect: "manual", signal: AbortSignal.timeout(10_000) },
      );
      const body = await response.text();
      if (!isBunnyErrorPage(body)) return null;
      fault = response.status;
    } catch {
      return null;
    }
  }
  return fault;
}

/**
 * True when this body is bunny.net's own error page rather than the site's.
 *
 * Two markers, and both are needed: the page names bunny.net, and it says
 * something went wrong. Matching the whole page would break the moment the page
 * is restyled. Matching "bunny" alone would call a site about rabbits broken,
 * and matching "error" alone would do the same to Astro's own 404.
 *
 * This only decides whether the deploy prints a warning, so the cost of being
 * wrong is one line of output either way.
 */
export function isBunnyErrorPage(body: string): boolean {
  const head = body.slice(0, 4000);
  return (
    /bunny\.net/i.test(head) &&
    /an error has occurred|error has occurred|request could not be/i.test(head)
  );
}
