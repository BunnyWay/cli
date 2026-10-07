/** Resolves after `ms`, or as soon as `signal` aborts, so a cancelled wait does not hold the process; callers check the signal after. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Bunny sends UTC timestamps without a zone suffix, which `Date.parse` would read as local time. */
export function parseBunnyDate(value: string | undefined | null): number {
  if (!value) return Number.NaN;

  return Date.parse(
    /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`,
  );
}
