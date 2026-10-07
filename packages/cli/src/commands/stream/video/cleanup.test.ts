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
const RESOLUTIONS_PATH = "/library/4321/videos/video-guid/resolutions";
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
    if (pathname === RESOLUTIONS_PATH) {
      return Response.json({
        success: true,
        data: {
          configuredResolutions: ["720p"],
          playlistResolutions: [
            { resolution: "240p", path: "/v/240p" },
            { resolution: "720p", path: "/v/720p" },
          ],
          hasOriginal: true,
        },
      });
    }
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

/** Run with stdout captured, since `logger.log` writes there rather than to console.log. */
async function captured(args: Record<string, unknown>): Promise<string> {
  const out: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation(((
    chunk: string,
  ) => {
    out.push(String(chunk));
    return true;
  }) as never);
  try {
    await run(args);
  } finally {
    write.mockRestore();
  }
  return out.join("");
}

// The dry run has to say what would go, not just "OK".
test("a dry run lists what would be deleted", async () => {
  const json = JSON.parse(
    await captured({ dryRun: true, all: false, nonConfigured: true }),
  );
  expect(json.plan).toEqual({
    items: [{ kind: "hls", resolution: "240p", path: "/v/240p" }],
    notPresent: [],
  });

  const text = await captured({
    dryRun: true,
    all: false,
    nonConfigured: true,
    output: "text",
  });
  expect(text).toContain("Would delete (1):");
  expect(text).toContain("HLS 240p  /v/240p");
});

// A real run with nothing to delete says so instead of calling the endpoint.
test("a cleanup that matches nothing deletes nothing", async () => {
  const json = JSON.parse(
    await captured({ all: false, resolutions: "144p", force: true }),
  );
  expect(seen).not.toContain(`POST ${CLEANUP_PATH}`);
  expect(json.plan.notPresent).toEqual(["144p"]);
});

test("an unattended cleanup without --force refuses before deleting", async () => {
  await expect(run({})).rejects.toThrow("exit 1");
  expect(printed.join("\n")).toContain("needs a confirmation prompt");
  expect(seen).not.toContain(`POST ${CLEANUP_PATH}`);
});
