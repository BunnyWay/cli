/** Map over `items` with at most `concurrency` promises in flight, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };
  const lanes = Math.min(concurrency, items.length) || 1;
  await Promise.all(Array.from({ length: lanes }, worker));
  return results;
}
