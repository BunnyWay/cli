import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { cleanupQuery, streamVideoCleanupCommand } from "./cleanup.ts";

test("cleanupQuery trims resolutions and lowercases outputs", () => {
  expect(
    cleanupQuery({ resolutions: " 240p , 360p ", outputs: "HLS" }),
  ).toEqual({ resolutionsToDelete: "240p,360p", outputs: "hls" });
});

// Every selector defaults to false server side, so a dry run alone is a silent no-op.
test("cleanupQuery refuses to run with nothing selected", () => {
  expect(() => cleanupQuery({ dryRun: true })).toThrow(
    /Nothing selected to clean up/,
  );
});

test("cleanupQuery rejects an undocumented --outputs value", () => {
  expect(() => cleanupQuery({ all: true, outputs: "dash" })).toThrow(
    /Invalid --outputs "dash"/,
  );
});

const CLEANUP_PATH = "/library/4321/videos/video-guid/resolutions/cleanup";
const originalFetch = globalThis.fetch;
const originalExit = process.exit;
let seen: string[] = [];
let printed: string[] = [];

beforeEach(() => {
  seen = [];
  printed = [];
  globalThis.fetch = (async (input: Request) => {
    const { pathname } = new URL(input.url);
    seen.push(`${input.method} ${pathname}`);
    if (pathname.endsWith("/videolibrary/4321")) {
      return Response.json({ Id: 4321, Name: "lib", ApiKey: "library-key" });
    }
    if (pathname === CLEANUP_PATH) return Response.json({ success: true });
    return Response.json({ guid: "video-guid", title: "clip.mp4" });
  }) as unknown as typeof fetch;
  process.exit = ((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never;
  spyOn(console, "log").mockImplementation((line: string) => {
    printed.push(line);
  });
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.exit = originalExit;
  (console.log as any).mockRestore();
  (console.error as any).mockRestore();
});

const run = (args: Record<string, unknown>) =>
  streamVideoCleanupCommand.handler({
    video: "video-guid",
    lib: "4321",
    apiKey: "account-key",
    profile: "default",
    output: "json",
    all: true,
    ...args,
  } as never);

test("a dry run skips the confirmation gate, even unattended", async () => {
  await run({ dryRun: true });
  expect(seen).toContain(`POST ${CLEANUP_PATH}`);
});

test("an unattended cleanup without --force refuses before deleting", async () => {
  await expect(run({})).rejects.toThrow("exit 1");
  expect(printed.join("\n")).toContain("needs a confirmation prompt");
  expect(seen).not.toContain(`POST ${CLEANUP_PATH}`);
});
