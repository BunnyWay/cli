async function pinTTY<T>(isTTY: boolean, fn: () => T | Promise<T>): Promise<T> {
  const originalStdinTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;
  process.stdin.isTTY = isTTY;
  process.stdout.isTTY = isTTY;
  try {
    return await fn();
  } finally {
    process.stdin.isTTY = originalStdinTTY;
    process.stdout.isTTY = originalStdoutTTY;
  }
}

export function withTTY<T>(fn: () => T | Promise<T>): Promise<T> {
  return pinTTY(true, fn);
}

export function withoutTTY<T>(fn: () => T | Promise<T>): Promise<T> {
  return pinTTY(false, fn);
}
