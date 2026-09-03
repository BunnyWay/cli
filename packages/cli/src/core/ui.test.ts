import { expect, test } from "bun:test";
import promptsLib from "prompts";
import { confirm, requireConfirmable } from "./ui.ts";

// Pins the injection escape hatch: this runner has no TTY, so if the wrapper's probe of the library's injected-answers state ever breaks, this fails instead of every inject-driven test silently getting cancelled prompts.
test("prompts.inject() bypasses the terminal requirement", async () => {
  promptsLib.inject([true]);
  expect(await confirm("sure?")).toBe(true);
});

const UI_PATH = new URL("./ui.ts", import.meta.url).pathname;

// Prompts must run in a subprocess: they grab the real stdin, and the EOF spin (BunnyWay/cli#171) would hang the test runner itself.
async function runConfirm(
  stdin: "ignore" | Blob,
  call = 'confirm("sure?")',
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const script = `const { confirm } = await import(${JSON.stringify(UI_PATH)}); console.log("result:" + (await ${call}));`;
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 8000);
  await proc.exited;
  clearTimeout(timer);
  return {
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
    exitCode: proc.exitCode,
  };
}

test("gate confirm fails non-zero when stdin is at EOF instead of spinning", async () => {
  const run = await runConfirm("ignore");
  expect(run.exitCode).not.toBe(0);
  expect(run.stderr).toContain("Confirmation required");
}, 10_000);

test("optional confirm declines quietly when stdin is at EOF", async () => {
  const run = await runConfirm(
    "ignore",
    'confirm("sure?", { optional: true })',
  );
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("result:false");
}, 10_000);

// Piped answers are deliberately unsupported: flags and --force are the automation contract.
test("piped stdin is refused instead of prompted", async () => {
  const gate = await runConfirm(new Blob(["y\n"]));
  expect(gate.exitCode).not.toBe(0);
  expect(gate.stderr).toContain("Confirmation required");
  const offer = await runConfirm(
    new Blob(["y\n"]),
    'confirm("sure?", { optional: true })',
  );
  expect(offer.exitCode).toBe(0);
  expect(offer.stdout).toContain("result:false");
}, 10_000);

// Only ui.ts may import the raw library: its EOF-safe prompts() wrapper is what keeps CI runs from spinning (type-only imports and prompts.inject in tests are fine).
test("no runtime imports of the prompts library outside ui.ts", async () => {
  const srcRoot = new URL("..", import.meta.url).pathname;
  const offenders: string[] = [];
  for await (const rel of new Bun.Glob("**/*.ts").scan(srcRoot)) {
    if (rel === "core/ui.ts" || rel.endsWith(".test.ts")) continue;
    const text = await Bun.file(srcRoot + rel).text();
    if (/^import (?!type ).*from "prompts";/m.test(text)) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});

const OPTS = { message: "Needs a prompt.", hint: "Re-run with --force." };

// Pin both TTY flags: read ambiently these tests pass under CI's pipes and fail in a developer's terminal.
// Always await the call: `return await` keeps the restore behind an async fn's completion instead of running an event loop turn early.
async function withTTY<T>(
  isTTY: boolean,
  fn: () => T | Promise<T>,
): Promise<T> {
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

test("withTTY keeps the flags pinned across an await point", async () => {
  const seen: (boolean | undefined)[] = [];
  await withTTY(true, async () => {
    seen.push(process.stdin.isTTY);
    await new Promise((resolve) => setTimeout(resolve, 20));
    seen.push(process.stdin.isTTY);
  });
  expect(seen).toEqual([true, true]);
});

test("requireConfirmable throws when there's no TTY to answer the prompt", async () => {
  await withTTY(false, () => {
    expect(() => requireConfirmable("text", OPTS)).toThrow("Needs a prompt.");
    expect(() => requireConfirmable("json", OPTS)).toThrow("Needs a prompt.");
  });
});

// `--output json` is unattended even on a terminal: the prompt would corrupt the JSON on stdout.
test("requireConfirmable throws for --output json even with a TTY", async () => {
  await withTTY(true, () => {
    expect(() => requireConfirmable("json", OPTS)).toThrow("Needs a prompt.");
    expect(() => requireConfirmable("text", OPTS)).not.toThrow();
  });
});

test("requireConfirmable passes with --force", async () => {
  await withTTY(false, () => {
    expect(() =>
      requireConfirmable("json", { ...OPTS, force: true }),
    ).not.toThrow();
  });
});
