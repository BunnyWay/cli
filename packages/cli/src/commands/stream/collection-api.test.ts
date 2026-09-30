import { expect, test } from "bun:test";
import {
  type CollectionModel,
  deleteCollection,
  fetchCollections,
} from "./collection-api.ts";
import type { StreamClient } from "./videos-api.ts";

function fakeClient(opts: {
  pages: number[];
  collections?: CollectionModel[];
  pageSize?: number;
  totalItems?: number;
  status?: unknown;
}): StreamClient {
  const list = opts.collections ?? [];
  return {
    GET: async (_path: string, init?: any) => {
      const page = init?.params?.query?.page ?? 1;
      opts.pages.push(page);
      const size = opts.pageSize ?? Math.max(list.length, 1);
      const start = (page - 1) * size;
      return {
        data: {
          ...(opts.totalItems === undefined
            ? {}
            : { totalItems: opts.totalItems }),
          itemsPerPage: size,
          items: list.slice(start, start + size),
        },
      };
    },
    DELETE: async () => ({ data: opts.status }),
  } as unknown as StreamClient;
}

const many = (n: number): CollectionModel[] =>
  Array.from({ length: n }, (_, i) => ({
    videoLibraryId: 4321,
    guid: `c${i}`,
  }));

// Without totalItems the old loop stopped after the first page.
test("fetchCollections drains on page fullness when totalItems is absent", async () => {
  const pages: number[] = [];
  const collections = await fetchCollections(
    fakeClient({ pages, collections: many(5), pageSize: 2 }),
    4321,
  );
  expect(collections.map((c) => c.guid)).toEqual([
    "c0",
    "c1",
    "c2",
    "c3",
    "c4",
  ]);
  expect(pages).toEqual([1, 2, 3]);
});

// An over-reported total must not loop forever.
test("fetchCollections stops on an empty page", async () => {
  const pages: number[] = [];
  const collections = await fetchCollections(
    fakeClient({ pages, collections: many(3), pageSize: 3, totalItems: 99 }),
    4321,
  );
  expect(collections).toHaveLength(3);
  expect(pages).toEqual([1, 2]);
});

// Stream can answer a 200 whose status body says the operation failed.
test("deleteCollection surfaces a failed status", async () => {
  await expect(
    deleteCollection(
      fakeClient({ pages: [], status: { success: false, message: "In use" } }),
      4321,
      "a",
    ),
  ).rejects.toThrow("Deleting the collection failed: In use");
});
