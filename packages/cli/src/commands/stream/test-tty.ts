// Test-only: pin both TTY flags so a resolver sees an interactive terminal under `bun test`.
export async function withTTY<T>(fn: () => T | Promise<T>): Promise<T> {
  const originalStdinTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  try {
    return await fn();
  } finally {
    process.stdin.isTTY = originalStdinTTY;
    process.stdout.isTTY = originalStdoutTTY;
  }
}
