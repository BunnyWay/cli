import type { components } from "@bunny.net/openapi-client/generated/stream.d.ts";
import { UserError } from "@/core/errors.ts";
import type { StreamClient } from "./videos-api.ts";

export type CollectionModel = components["schemas"]["CollectionModel"];
export type UpdateCollectionModel =
  components["schemas"]["UpdateCollectionModel"];

// The listing endpoint's documented default; it has no documented maximum.
const COLLECTIONS_PER_PAGE = 100;

/**
 * Fetch every collection in a library, draining the paginated listing.
 *
 * Same envelope and same rules as the video listing: a full page implies there
 * may be another, a short or empty page ends the drain, and `totalItems` is an
 * upper bound only when the API sends it.
 */
export async function fetchCollections(
  client: StreamClient,
  libraryId: number,
  opts: { search?: string } = {},
): Promise<CollectionModel[]> {
  const collections: CollectionModel[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/library/{libraryId}/collections", {
      params: {
        path: { libraryId },
        query: {
          page,
          itemsPerPage: COLLECTIONS_PER_PAGE,
          search: opts.search,
        },
      },
    });
    const items = data?.items ?? [];
    collections.push(...items);

    const total = data?.totalItems;
    if (total !== undefined && collections.length >= total) break;

    const pageSize = data?.itemsPerPage ?? COLLECTIONS_PER_PAGE;
    if (items.length < pageSize) break;
    page++;
  }
  return collections;
}

/**
 * Fetch one collection by ID.
 *
 * Thumbnails are opt-in on this endpoint (the API defaults them off), and a
 * detail view is exactly where the preview images are worth having.
 */
export async function fetchCollection(
  client: StreamClient,
  libraryId: number,
  collectionId: string,
): Promise<CollectionModel> {
  const { data } = await client.GET(
    "/library/{libraryId}/collections/{collectionId}",
    {
      params: {
        path: { libraryId, collectionId },
        query: { includeThumbnails: true },
      },
    },
  );
  if (!data) throw new UserError(`Collection ${collectionId} not found.`);
  return data;
}

/** Create a collection. The name is the only field the API accepts. */
export async function createCollection(
  client: StreamClient,
  libraryId: number,
  name: string,
): Promise<CollectionModel> {
  const { data } = await client.POST("/library/{libraryId}/collections", {
    params: { path: { libraryId } },
    body: { name },
  });
  if (!data?.guid) {
    throw new UserError(
      `Creating the collection "${name}" did not return a collection ID.`,
    );
  }
  return data;
}

/**
 * Rename a collection.
 *
 * The update endpoint answers with a plain status rather than the collection, so
 * callers that want the new state re-fetch it.
 */
export async function renameCollection(
  client: StreamClient,
  libraryId: number,
  collectionId: string,
  name: string,
): Promise<void> {
  const { data } = await client.POST(
    "/library/{libraryId}/collections/{collectionId}",
    { params: { path: { libraryId, collectionId } }, body: { name } },
  );
  if (data && data.success === false) {
    throw new UserError(
      `Renaming the collection failed: ${data.message ?? "the request was rejected"}`,
    );
  }
}

/** Delete a collection. The videos in it survive; they just lose the collection. */
export async function deleteCollection(
  client: StreamClient,
  libraryId: number,
  collectionId: string,
): Promise<void> {
  const { data } = await client.DELETE(
    "/library/{libraryId}/collections/{collectionId}",
    { params: { path: { libraryId, collectionId } } },
  );
  if (data && data.success === false) {
    throw new UserError(
      `Deleting the collection failed: ${data.message ?? "the request was rejected"}`,
    );
  }
}
