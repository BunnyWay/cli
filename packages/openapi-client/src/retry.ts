/**
 * Retry a request the API rejected with 429 Too Many Requests.
 *
 * bunny.net's spike protection answers a short burst of requests (a command
 * that reads every storage zone, say) with an empty 429 and no Retry-After.
 * A 429 means the request was not processed, so resending it is safe for any
 * method. Waits honour Retry-After when present, else back off exponentially
 * with jitter, so parallel requests don't retry in lockstep.
 *
 * Only requests whose body is absent or JSON are retried: resending needs a
 * clone, and cloning a binary upload would buffer all of it in memory.
 *
 * The request's signal is honoured: an abort during a wait stops it, and
 * nothing is resent after one.
 */

/** The retry fields of {@link ClientOptions}, so a client's options can be passed as they are. */
export interface RetryOptions {
  /** Retries after the first attempt; 0 disables retrying. Default 4. */
  maxRetries?: number;
  /** With `onDebug`, reports each retry. */
  verbose?: boolean;
  onDebug?: (msg: string) => void;
  /** Injected for tests; must settle early (by rejecting) when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** First back-off step; doubles per retry. */
const BASE_DELAY_MS = 1000;
/** Longest single wait, Retry-After included. */
const MAX_DELAY_MS = 30_000;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // An abort that already happened fires no event, so the timer would run its full length.
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Retry-After as delta-seconds or an HTTP date; undefined when absent or unparsable. */
export function retryAfterMs(
  header: string | null,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function isReplayable(request: Request): boolean {
  if (request.body === null) return true;
  const type = request.headers.get("content-type") ?? "";
  return /json/i.test(type);
}

/** A `fetch` for openapi-fetch's `createClient` that retries 429s; every client factory passes it. */
export function retryingFetch(
  options: RetryOptions = {},
): (input: Request) => Promise<Response> {
  const {
    maxRetries = 4,
    sleep = defaultSleep,
    random = Math.random,
  } = options;
  // A fractional or NaN budget would never match `attempt` below and retry forever.
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new TypeError(
      `maxRetries must be a non-negative integer, got ${maxRetries}.`,
    );
  }
  const debug = options.verbose ? options.onDebug : undefined;

  return async (input) => {
    // Read globalThis.fetch per call so a fetch stubbed after client creation is used.
    if (maxRetries === 0 || !isReplayable(input))
      return globalThis.fetch(input);

    for (let attempt = 0; ; attempt++) {
      const last = attempt === maxRetries;
      const response = await globalThis.fetch(
        last ? input : (input.clone() as typeof input),
      );
      if (response.status !== 429 || last) return response;

      const hinted = retryAfterMs(response.headers.get("retry-after"));
      // A server asking for a longer wait than we allow gets its 429 back instead of a hung CLI.
      if (hinted !== undefined && hinted > MAX_DELAY_MS) return response;
      // Equal jitter: at least half the step, so a retry never fires straight back into the spike window.
      const step = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      const delayMs = hinted ?? Math.round(step / 2 + (random() * step) / 2);

      await response.body?.cancel();
      debug?.(
        `← 429 on ${input.url.split("?")[0]}, retry ${attempt + 1} in ${delayMs} ms`,
      );
      input.signal.throwIfAborted();
      await sleep(delayMs, input.signal);
      input.signal.throwIfAborted();
    }
  };
}
