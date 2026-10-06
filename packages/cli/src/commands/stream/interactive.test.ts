import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreClient, VideoLibraryModel } from "./api.ts";
import {
  resolveLibraryInteractive,
  writeStreamManifest,
} from "./interactive.ts";
import { withTTY } from "./test-tty.ts";

const LIBRARIES: VideoLibraryModel[] = [
  { Id: 1, Name: "Alpha", VideoCount: 3 },
  { Id: 2, Name: "marketing", VideoCount: 0 },
];

function fakeCoreClient(calls: string[]): CoreClient {
  return {
    GET: async (path: string, options?: any) => {
      calls.push(path);
      if (path === "/videolibrary/{id}") {
        return {
          data: LIBRARIES.find((lib) => lib.Id === options?.params?.path?.id),
        };
      }
      const search = (options?.params?.query?.search ?? "") as string;
      return {
        data: {
          Items: LIBRARIES.filter((lib) =>
            (lib.Name ?? "").toLowerCase().includes(search.toLowerCase()),
          ),
          HasMoreItems: false,
        },
      };
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

// `bun test` has no TTY, so only the manifest can stand in for an explicit reference here.
test("a linked library resolves without a reference, even unattended", async () => {
  writeStreamManifest(LIBRARIES[0] as VideoLibraryModel);
  const lib = await resolveLibraryInteractive(fakeCoreClient([]), undefined);
  expect(lib.Id).toBe(1);
});

test("an explicit reference wins over the linked library", async () => {
  writeStreamManifest(LIBRARIES[0] as VideoLibraryModel);
  const lib = await resolveLibraryInteractive(fakeCoreClient([]), "marketing");
  expect(lib.Id).toBe(2);
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

// --force must not let a destructive command delete a library nobody named.
test("force refuses to pick a library even in a terminal", async () => {
  const calls: string[] = [];
  const client = {
    GET: async (path: string) => {
      calls.push(path);
      return { data: { Items: [], HasMoreItems: false } };
    },
  } as unknown as CoreClient;

  await withTTY(() =>
    expect(
      resolveLibraryInteractive(client, undefined, { force: true }),
    ).rejects.toThrow("A library is required."),
  );
  expect(calls).toEqual([]);
});
