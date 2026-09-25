import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreClient, createToolContext } from "@bunny.net/tools";
import {
  resolveLibraryInteractive,
  writeStreamManifest,
} from "./interactive.ts";

const LIBRARIES = [
  { Id: 1, Name: "Alpha", ApiKey: "k1" },
  { Id: 2, Name: "marketing", ApiKey: "k2" },
];

function fakeContext(calls: string[]) {
  const core = {
    GET: async (path: string, options?: any) => {
      calls.push(path);
      if (path === "/user") return { data: { AccountId: "acct" } };
      if (path === "/videolibrary/{id}")
        return { data: LIBRARIES.find((l) => l.Id === options.params.path.id) };
      const search = options.params.query.search.toLowerCase();
      return {
        data: {
          Items: LIBRARIES.filter((l) => l.Name.toLowerCase().includes(search)),
        },
      };
    },
  } as unknown as CoreClient;
  return createToolContext({ clients: { core } });
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

// `bun test` has no TTY, so these take the unattended path, where only a ref or the manifest can name the library.
test("an explicit reference wins over the linked library, which resolves unattended", async () => {
  writeStreamManifest({ id: 1, name: "Alpha", videoCount: 0 });
  const calls: string[] = [];

  const linked = await resolveLibraryInteractive(fakeContext(calls), undefined);
  const named = await resolveLibraryInteractive(fakeContext([]), "marketing");

  expect(linked.id).toBe(1);
  expect(calls).not.toContain("/videolibrary");
  expect(named.id).toBe(2);
});

test("with nothing to go on, unattended runs name the --library flag", async () => {
  const error = await resolveLibraryInteractive(fakeContext([]), undefined, {
    output: "json",
  }).catch((err) => err);
  expect(error.hint).toContain("--library");
});
