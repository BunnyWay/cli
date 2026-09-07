import { expect, test } from "bun:test";
import type { CollectionModel } from "@/commands/stream/collection-api.ts";
import type { StreamClient } from "@/commands/stream/videos-api.ts";
import { resolveCollectionInteractive } from "./interactive.ts";

const COLLECTION: CollectionModel = {
  videoLibraryId: 4321,
  guid: "collection-guid",
  name: "Tutorials",
  videoCount: 3,
};

function fakeStreamClient(paths: string[]): StreamClient {
  return {
    GET: async (path: string, init?: any) => {
      paths.push(path);
      if (path === "/library/{libraryId}/collections/{collectionId}") {
        return {
          data:
            init?.params?.path?.collectionId === COLLECTION.guid
              ? COLLECTION
              : undefined,
        };
      }
      return { data: { totalItems: 1, items: [COLLECTION] } };
    },
  } as unknown as StreamClient;
}

// `bun test` has no TTY, so every case here takes the unattended path.
test("an explicit ID is fetched directly, with no listing", async () => {
  const paths: string[] = [];
  const collection = await resolveCollectionInteractive(
    fakeStreamClient(paths),
    4321,
    "collection-guid",
  );

  expect(collection.name).toBe("Tutorials");
  expect(paths).toEqual(["/library/{libraryId}/collections/{collectionId}"]);
});

test("an unknown ID reports the collection as missing", async () => {
  await expect(
    resolveCollectionInteractive(fakeStreamClient([]), 4321, "nope"),
  ).rejects.toThrow("Collection nope not found.");
});

test("no ID and no way to prompt errors instead of listing", async () => {
  const paths: string[] = [];
  await expect(
    resolveCollectionInteractive(fakeStreamClient(paths), 4321, undefined),
  ).rejects.toThrow("A collection is required.");
  expect(paths).toEqual([]);
});

// --force must not let a destructive command delete a collection nobody named.
test("force refuses to pick a collection", async () => {
  const paths: string[] = [];
  await expect(
    resolveCollectionInteractive(fakeStreamClient(paths), 4321, undefined, {
      force: true,
    }),
  ).rejects.toThrow("A collection is required.");
  expect(paths).toEqual([]);
});

test("the missing-collection error points at the listing command", async () => {
  try {
    await resolveCollectionInteractive(fakeStreamClient([]), 4321, undefined, {
      output: "json",
    });
    throw new Error("expected a UserError");
  } catch (err) {
    expect((err as { hint?: string }).hint).toContain(
      "bunny stream collection list",
    );
  }
});
