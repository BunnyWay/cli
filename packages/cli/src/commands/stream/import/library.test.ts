import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prompts from "prompts";
import { writeStreamManifest } from "@/commands/stream/interactive.ts";
import { libraryFeaturesFromFlags } from "@/commands/stream/library/features.ts";
import { withTTY } from "@/commands/stream/test-tty.ts";
import { type CoreClient, createToolContext } from "@/tools/index.ts";
import { resolveImportLibrary } from "./library.ts";

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
  writeStreamManifest({ Id: 1, Name: "Alpha" });
  const calls: string[] = [];

  const linked = await resolveImportLibrary(fakeContext(calls), undefined);
  const named = await resolveImportLibrary(fakeContext([]), "marketing");

  expect(linked.id).toBe(1);
  expect(calls).not.toContain("/videolibrary");
  expect(named.id).toBe(2);
});

test("with nothing to go on, unattended runs name the --library flag", async () => {
  const error = await resolveImportLibrary(fakeContext([]), undefined, {
    output: "json",
  }).catch((err) => err);
  expect(error.hint).toContain("--library");
});

const PREMIUM_FLAGS = libraryFeaturesFromFlags({
  encodingPlan: "1080p",
  codecs: "x264,av1",
});

test("feature flags are refused for an existing library instead of being dropped", async () => {
  const named = await resolveImportLibrary(fakeContext([]), "marketing", {
    featureFlags: PREMIUM_FLAGS,
  }).catch((err) => err);
  expect(named.message).toContain("--encoding-plan, --codecs");
  expect(named.message).toContain("--library");

  writeStreamManifest({ Id: 1, Name: "Alpha" });
  const linked = await resolveImportLibrary(fakeContext([]), undefined, {
    featureFlags: PREMIUM_FLAGS,
  }).catch((err) => err);
  expect(linked.message).toContain("linked to video library 1");

  // --no-features only skips a step, so it is fine on an existing library.
  const skipped = await resolveImportLibrary(fakeContext([]), "marketing", {
    featureFlags: libraryFeaturesFromFlags({ features: false }),
  });
  expect(skipped.id).toBe(2);
});

test("unattended, feature flags point at creating the library first", async () => {
  const error = await resolveImportLibrary(fakeContext([]), undefined, {
    output: "json",
    offerCreate: true,
    featureFlags: PREMIUM_FLAGS,
  }).catch((err) => err);
  expect(error.hint).toContain("bunny stream libraries create <name>");
});

test("feature flags create a new library without asking the features step", async () => {
  const posted: any[] = [];
  const core = {
    GET: async (path: string) => {
      if (path === "/videolibrary/languages")
        return {
          data: [
            { ShortCode: "EN", Name: "English", SupportTranscribing: true },
          ],
        };
      return { data: { Items: LIBRARIES, HasMoreItems: false } };
    },
    POST: async (_path: string, options: any) => {
      posted.push(options.body);
      return { data: { Id: 9, Name: options.body.Name, ApiKey: "k9" } };
    },
  } as unknown as CoreClient;
  const ctx = createToolContext({ clients: { core } });

  // Only the name and the replication question: no "Import into" picker and no features prompts.
  prompts.inject(["fresh", false]);
  const library = await withTTY(() =>
    resolveImportLibrary(ctx, undefined, {
      output: "text",
      offerCreate: true,
      featureFlags: libraryFeaturesFromFlags({
        encodingPlan: "1080p",
        transcribingLanguages: "en",
        transcribingTitle: true,
      }),
    }),
  );

  expect(library.id).toBe(9);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    Name: "fresh",
    EncodingTier: 1,
    OutputCodecs: "x264",
    EnableTranscribing: true,
    TranscribingCaptionLanguages: ["en"],
    EnableTranscribingTitleGeneration: true,
  });
});

test("feature flags are refused with --dry-run or --resume, which never create a library", async () => {
  const error = await withTTY(() =>
    resolveImportLibrary(fakeContext([]), undefined, {
      output: "text",
      offerCreate: false,
      featureFlags: PREMIUM_FLAGS,
    }),
  ).catch((err) => err);
  expect(error.message).toContain("--dry-run and --resume");
});

test("--no-features alone still asks whether to import into a new or an existing library", async () => {
  const core = {
    GET: async () => ({ data: { Items: LIBRARIES, HasMoreItems: false } }),
  } as unknown as CoreClient;
  prompts.inject(["existing", 2, false]);
  const library = await withTTY(() =>
    resolveImportLibrary(createToolContext({ clients: { core } }), undefined, {
      output: "text",
      offerCreate: true,
      offerLink: true,
      featureFlags: libraryFeaturesFromFlags({ features: false }),
    }),
  );
  expect(library.id).toBe(2);
});
