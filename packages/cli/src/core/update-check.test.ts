import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULE_PATH = new URL("./update-check.ts", import.meta.url).pathname;

test.each([
  "getLatestVersion",
  "checkForUpdate",
])("%s aborts a stalled request and returns quietly", async (method) => {
  const cacheDir = mkdtempSync(join(tmpdir(), "bunny-update-timeout-"));
  const script = `
    globalThis.fetch = async (_url, options) => {
      if (!(options?.signal instanceof AbortSignal)) throw new Error("Missing timeout signal");
      return await new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    };
    const watchdog = setTimeout(() => process.exit(99), 5000);
    const checks = await import(${JSON.stringify(MODULE_PATH)});
    const start = Date.now();
    const result = await checks[${JSON.stringify(method)}]();
    clearTimeout(watchdog);
    console.log(JSON.stringify({ result: result ?? null, elapsed: Date.now() - start }));
  `;
  try {
    const proc = Bun.spawn({
      cmd: [process.execPath, "-e", script],
      env: { ...process.env, XDG_CACHE_HOME: cacheDir },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.result).toBeNull();
    expect(result.elapsed).toBeGreaterThanOrEqual(1500);
    expect(result.elapsed).toBeLessThan(5000);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}, 10_000);
