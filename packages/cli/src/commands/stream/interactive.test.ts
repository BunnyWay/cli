import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreClient, VideoLibraryModel } from "./api.ts";
import { STREAM_MANIFEST, type StreamLibraryManifest } from "./constants.ts";
import {
  resolveLibraryInteractive,
  writeStreamManifest,
} from "./interactive.ts";

const LIBRARIES: VideoLibraryModel[] = [
  { Id: 1, Name: "Alpha", VideoCount: 3 },
  { Id: 2, Name: "marketing", VideoCount: 0 },
];

/** Minimal path-branching fake core client (same shape as api.test.ts). */
function fakeCoreClient(calls: string[]): CoreClient {
  return {
    GET: async (path: string, options?: any) => {
      calls.push(path);
      if (path === "/videolibrary/{id}") {
        return {
          data: LIBRARIES.find((lib) => lib.Id === options?.params?.path?.id),
        };
      }
      if (path === "/videolibrary") {
        const search = (options?.params?.query?.search ?? "") as string;
        return {
          data: {
            Items: LIBRARIES.filter((lib) =>
              (lib.Name ?? "").toLowerCase().includes(search.toLowerCase()),
            ),
            HasMoreItems: false,
          },
        };
      }
      throw new Error(`unexpected GET ${path}`);
    },
  } as unknown as CoreClient;
}

let dir = "";
let cwd = "";

beforeEach(async () => {
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "bunny-stream-link-"));
  process.chdir(dir);
});

afterEach(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
});

async function readStreamManifest(): Promise<StreamLibraryManifest> {
  const raw = await readFile(join(dir, ".bunny", STREAM_MANIFEST), "utf-8");
  return JSON.parse(raw) as StreamLibraryManifest;
}

test("writeStreamManifest records the library ID and name", async () => {
  writeStreamManifest(LIBRARIES[1] as VideoLibraryModel);
  expect(await readStreamManifest()).toEqual({ id: 2, name: "marketing" });
});

// `bun test` has no TTY, so every case here takes the unattended path: the
// manifest is the only thing that can stand in for an explicit reference.
test("a linked library resolves without a reference, even unattended", async () => {
  writeStreamManifest(LIBRARIES[0] as VideoLibraryModel);
  const calls: string[] = [];

  const lib = await resolveLibraryInteractive(fakeCoreClient(calls), undefined);

  expect(lib.Id).toBe(1);
  expect(calls).toEqual(["/videolibrary/{id}"]);
});

test("an explicit reference wins over the linked library", async () => {
  writeStreamManifest(LIBRARIES[0] as VideoLibraryModel);
  const calls: string[] = [];

  const lib = await resolveLibraryInteractive(
    fakeCoreClient(calls),
    "marketing",
  );

  expect(lib.Id).toBe(2);
  expect(calls).toEqual(["/videolibrary", "/videolibrary/{id}"]);
});

test("ignoreManifest skips the linked library so linking can re-pick", async () => {
  writeStreamManifest(LIBRARIES[0] as VideoLibraryModel);
  const calls: string[] = [];

  await expect(
    resolveLibraryInteractive(fakeCoreClient(calls), undefined, {
      ignoreManifest: true,
    }),
  ).rejects.toThrow("A library is required.");
  expect(calls).toEqual([]);
});

test("force skips the picker instead of prompting", async () => {
  const calls: string[] = [];
  await expect(
    resolveLibraryInteractive(fakeCoreClient(calls), undefined, {
      force: true,
    }),
  ).rejects.toThrow("A library is required.");
  expect(calls).toEqual([]);
});

test("the missing-library error points at linking", async () => {
  try {
    await resolveLibraryInteractive(fakeCoreClient([]), undefined, {
      output: "json",
    });
    throw new Error("expected a UserError");
  } catch (err) {
    expect((err as { hint?: string }).hint).toContain("bunny stream link");
  }
});
