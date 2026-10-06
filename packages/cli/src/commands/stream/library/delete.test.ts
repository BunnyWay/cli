import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { STREAM_MANIFEST } from "@/commands/stream/constants.ts";
import { writeStreamManifest } from "@/commands/stream/interactive.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest } from "@/core/manifest.ts";
import { streamLibraryDeleteCommand } from "./delete.ts";

const originalFetch = globalThis.fetch;
let logSpy: ReturnType<typeof spyOn>;
let dir = "";
let cwd = "";

beforeEach(async () => {
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-delete-"));
  process.chdir(dir);
  logSpy = spyOn(logger, "log").mockImplementation(() => true);
  globalThis.fetch = (async (input: Request | string) => {
    const request = input instanceof Request ? input : new Request(input);
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ Id: 2, Name: "marketing", VideoCount: 0 });
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  logSpy.mockRestore();
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
});

function deleteLibrary(library: string): Promise<unknown> {
  return (
    streamLibraryDeleteCommand.handler as (args: unknown) => Promise<unknown>
  )({
    library,
    force: true,
    apiKey: "test-key",
    profile: "default",
    output: "json",
  } as unknown as ArgumentsCamelCase);
}

test("deleting a library removes the link only when it points at that library", async () => {
  writeStreamManifest({ Id: 1, Name: "Alpha" });
  await deleteLibrary("2");
  expect(loadManifest(STREAM_MANIFEST)).toEqual({ id: 1, name: "Alpha" });

  writeStreamManifest({ Id: 2, Name: "marketing" });
  await deleteLibrary("2");
  expect(loadManifest(STREAM_MANIFEST)).toEqual({});
});
