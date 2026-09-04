import { expect, test } from "bun:test";
import {
  type CollectionModel,
  createCollection,
  deleteCollection,
  fetchCollection,
  fetchCollections,
  renameCollection,
} from "./collection-api.ts";
import type { StreamClient } from "./videos-api.ts";

interface Call {
  method: string;
  path: string;
  init?: Record<string, any>;
}

const COLLECTIONS: CollectionModel[] = [
  { videoLibraryId: 4321, guid: "a", name: "Alpha", videoCount: 2 },
  { videoLibraryId: 4321, guid: "b", name: "Beta", videoCount: 0 },
  { videoLibraryId: 4321, guid: "c", name: "Gamma", videoCount: 7 },
];

function fakeClient(opts: {
  calls: Call[];
  collections?: CollectionModel[];
  pageSize?: number;
  totalItems?: number;
  /** Model an API that sends no totalItems at all. */
  omitTotal?: boolean;
  status?: unknown;
  single?: CollectionModel;
}): StreamClient {
  const list = opts.collections ?? [];
  return {
    GET: async (path: string, init?: any) => {
      opts.calls.push({ method: "GET", path, init });
      if (path === "/library/{libraryId}/collections/{collectionId}") {
        const id = init?.params?.path?.collectionId;
        return {
          data:
            opts.single ??
            list.find((collection) => collection.guid === id) ??
            undefined,
        };
      }
      const query = init?.params?.query ?? {};
      const search = (query.search ?? "") as string;
      const matched = search
        ? list.filter((collection) => (collection.name ?? "").includes(search))
        : list;
      const size = opts.pageSize ?? Math.max(matched.length, 1);
      const start = ((query.page ?? 1) - 1) * size;
      return {
        data: {
          // The spec's envelope reports the page size it actually used, which is
          // what tells the client whether a page came back full.
          ...(opts.omitTotal
            ? {}
            : { totalItems: opts.totalItems ?? matched.length }),
          itemsPerPage: size,
          items: matched.slice(start, start + size),
        },
      };
    },
    POST: async (path: string, init?: any) => {
      opts.calls.push({ method: "POST", path, init });
      return { data: opts.status ?? opts.single };
    },
    DELETE: async (path: string, init?: any) => {
      opts.calls.push({ method: "DELETE", path, init });
      return { data: opts.status };
    },
  } as unknown as StreamClient;
}

test("fetchCollections drains every page", async () => {
  const calls: Call[] = [];
  const collections = await fetchCollections(
    fakeClient({ calls, collections: COLLECTIONS, pageSize: 2 }),
    4321,
  );

  expect(collections.map((collection) => collection.guid)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(calls.map((call) => call.init?.params?.query?.page)).toEqual([1, 2]);
  expect(calls[0]?.path).toBe("/library/{libraryId}/collections");
});

// Same guard as the video listing: an over-reported total must not loop forever.
test("fetchCollections stops on an empty page", async () => {
  const calls: Call[] = [];
  const collections = await fetchCollections(
    fakeClient({
      calls,
      collections: COLLECTIONS,
      pageSize: 3,
      totalItems: 99,
    }),
    4321,
  );
  expect(collections).toHaveLength(3);
  expect(calls).toHaveLength(2);
});

// Without totalItems the old loop stopped after the first page.
test("fetchCollections drains on page fullness when totalItems is absent", async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    videoLibraryId: 4321,
    guid: `c${i}`,
    name: `Collection ${i}`,
  }));
  const calls: Call[] = [];

  const collections = await fetchCollections(
    fakeClient({ calls, collections: many, pageSize: 2, omitTotal: true }),
    4321,
  );

  // Two full pages, then a short one that ends the drain.
  expect(collections.map((c) => c.guid)).toEqual([
    "c0",
    "c1",
    "c2",
    "c3",
    "c4",
  ]);
  expect(calls).toHaveLength(3);
});

test("fetchCollections passes the search term through", async () => {
  const calls: Call[] = [];
  const collections = await fetchCollections(
    fakeClient({ calls, collections: COLLECTIONS }),
    4321,
    { search: "Alph" },
  );
  expect(collections.map((collection) => collection.name)).toEqual(["Alpha"]);
  expect(calls[0]?.init?.params?.query?.search).toBe("Alph");
});

// The API defaults thumbnails off, but a detail view promises preview URLs.
test("fetchCollection asks for the preview thumbnails", async () => {
  const calls: Call[] = [];
  await fetchCollection(
    fakeClient({ calls, collections: COLLECTIONS }),
    4321,
    "a",
  );
  expect(calls[0]?.init?.params?.query).toEqual({ includeThumbnails: true });
});

test("fetchCollection reports a missing collection", async () => {
  await expect(
    fetchCollection(fakeClient({ calls: [], collections: [] }), 4321, "nope"),
  ).rejects.toThrow("Collection nope not found.");
});

test("createCollection posts the name and returns the collection", async () => {
  const calls: Call[] = [];
  const created = await createCollection(
    fakeClient({ calls, single: COLLECTIONS[0] }),
    4321,
    "Alpha",
  );

  expect(created.guid).toBe("a");
  expect(calls[0]?.path).toBe("/library/{libraryId}/collections");
  expect(calls[0]?.init?.body).toEqual({ name: "Alpha" });
});

test("createCollection fails loudly when no collection comes back", async () => {
  await expect(
    createCollection(fakeClient({ calls: [], single: undefined }), 4321, "X"),
  ).rejects.toThrow(
    'Creating the collection "X" did not return a collection ID.',
  );
});

test("renameCollection posts the new name to the collection path", async () => {
  const calls: Call[] = [];
  await renameCollection(
    fakeClient({ calls, status: { success: true } }),
    4321,
    "a",
    "Renamed",
  );

  expect(calls[0]?.path).toBe(
    "/library/{libraryId}/collections/{collectionId}",
  );
  expect(calls[0]?.init?.params?.path).toEqual({
    libraryId: 4321,
    collectionId: "a",
  });
  expect(calls[0]?.init?.body).toEqual({ name: "Renamed" });
});

test("renameCollection surfaces a failed status", async () => {
  await expect(
    renameCollection(
      fakeClient({ calls: [], status: { success: false, message: "Taken" } }),
      4321,
      "a",
      "Renamed",
    ),
  ).rejects.toThrow("Renaming the collection failed: Taken");
});

test("deleteCollection deletes by ID and surfaces a failed status", async () => {
  const calls: Call[] = [];
  await deleteCollection(
    fakeClient({ calls, status: { success: true } }),
    4321,
    "a",
  );
  expect(calls[0]?.method).toBe("DELETE");
  expect(calls[0]?.init?.params?.path).toEqual({
    libraryId: 4321,
    collectionId: "a",
  });

  await expect(
    deleteCollection(
      fakeClient({ calls: [], status: { success: false, message: "In use" } }),
      4321,
      "a",
    ),
  ).rejects.toThrow("Deleting the collection failed: In use");
});
