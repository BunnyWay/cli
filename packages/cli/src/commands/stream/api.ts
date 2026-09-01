import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "../../core/errors.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type VideoLibraryModel = components["schemas"]["VideoLibraryModel"];
export type VideoLibraryCreateModel =
  components["schemas"]["VideoLibraryCreateModel"];

export type SafeVideoLibrary = Omit<
  VideoLibraryModel,
  "ApiKey" | "ReadOnlyApiKey" | "ApiAccessKey"
>;

// Strip the read-write/read-only library keys so list/show/create JSON never
// leaks credentials; use `stream library credentials` to retrieve those on purpose.
// ApiAccessKey is deprecated but carries the same value as ApiKey, so leaving it
// in would leak the write-capable key right back out.
export function toSafeVideoLibrary(
  library: VideoLibraryModel,
): SafeVideoLibrary {
  const { ApiKey: _k, ReadOnlyApiKey: _r, ApiAccessKey: _a, ...safe } = library;
  return safe;
}

/** Fetch all Stream video libraries on the account, paginated and sorted by name. */
export async function fetchLibraries(
  client: CoreClient,
): Promise<VideoLibraryModel[]> {
  const libraries: VideoLibraryModel[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/videolibrary", {
      params: { query: { page, perPage: 1000 } },
    });
    libraries.push(...(data?.Items ?? []));
    if (!data?.HasMoreItems) break;
    page++;
  }
  return libraries.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
}

/** Fetch a single video library by ID. */
export async function fetchLibrary(
  client: CoreClient,
  id: number,
): Promise<VideoLibraryModel> {
  const { data } = await client.GET("/videolibrary/{id}", {
    params: { path: { id } },
  });
  if (!data) throw new UserError(`Video library ${id} not found.`);
  return data;
}

/**
 * Resolve a library reference (numeric ID or name) to a full library.
 *
 * Numeric input is treated as a library ID; anything else is matched against
 * the account's libraries by name.
 */
export async function resolveLibrary(
  client: CoreClient,
  nameOrId: string,
): Promise<VideoLibraryModel> {
  const ref = nameOrId.trim();
  if (!ref) throw new UserError("A library name or ID is required.");

  if (/^\d+$/.test(ref)) return fetchLibrary(client, Number(ref));

  // page must be >= 1: at page 0 the endpoint returns a plain array instead of
  // the { Items, ... } envelope, and the match below would never find anything.
  const { data } = await client.GET("/videolibrary", {
    params: { query: { page: 1, search: ref, perPage: 1000 } },
  });
  const match = (data?.Items ?? []).find(
    (lib) => (lib.Name ?? "").toLowerCase() === ref.toLowerCase(),
  );
  if (!match?.Id) {
    throw new UserError(
      `No video library found for "${nameOrId}".`,
      'Run "bunny stream library list" to see your libraries.',
    );
  }
  return fetchLibrary(client, match.Id);
}
