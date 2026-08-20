import { expect, test } from "bun:test";
import { requireConfirmable } from "./ui.ts";

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

test("confirm still reads piped answers", async () => {
  expect((await runConfirm(new Blob(["y\n"]))).stdout).toContain("result:true");
  expect((await runConfirm(new Blob(["n\n"]))).stdout).toContain(
    "result:false",
  );
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

// `bun test` runs without a TTY, so every call here takes the unattended path.
test("requireConfirmable throws when there's no TTY to answer the prompt", () => {
  expect(() => requireConfirmable("text", OPTS)).toThrow("Needs a prompt.");
  expect(() => requireConfirmable("json", OPTS)).toThrow("Needs a prompt.");
});

test("requireConfirmable passes with --force", () => {
  expect(() =>
    requireConfirmable("json", { ...OPTS, force: true }),
  ).not.toThrow();
});
