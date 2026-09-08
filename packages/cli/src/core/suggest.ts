function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(tmp + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = tmp;
    }
  }
  return prev[b.length] ?? 0;
}

/** Closest candidate to `input`, or undefined when nothing is near enough. */
export function suggest(
  input: string,
  candidates: Iterable<string>,
): string | undefined {
  const needle = input.toLowerCase();
  // A short input has few edits to spare, so scale the tolerance instead of always allowing three.
  const tolerance = Math.min(3, Math.max(1, Math.floor(needle.length / 2)));
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const name = candidate.toLowerCase();
    if (name === needle) continue;
    // An abbreviation such as `sto` is a near miss that edit distance scores as far.
    const score =
      needle.length > 1 && name.startsWith(needle)
        ? 0.5
        : distance(needle, name);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best && bestScore <= tolerance ? best : undefined;
}
