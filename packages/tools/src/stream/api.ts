import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/core";
import type { CoreClient } from "../context.ts";

export type VideoLibraryModel = components["schemas"]["VideoLibraryModel"];

type Opts = { signal?: AbortSignal };

/** Every video library on the account, paged through and sorted by name. */
export async function fetchLibraries(
  client: CoreClient,
  opts: Opts = {},
): Promise<VideoLibraryModel[]> {
  const libraries: VideoLibraryModel[] = [];
  for (let page = 1; ; page++) {
    const { data } = await client.GET("/videolibrary", {
      params: { query: { page, perPage: 1000 } },
      signal: opts.signal,
    });
    libraries.push(...(data?.Items ?? []));
    if (!data?.HasMoreItems) break;
  }
  return libraries.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
}

export async function fetchLibrary(
  client: CoreClient,
  id: number,
  opts: Opts = {},
): Promise<VideoLibraryModel> {
  const { data } = await client.GET("/videolibrary/{id}", {
    params: { path: { id } },
    signal: opts.signal,
  });
  if (!data) throw new UserError(`Video library ${id} not found.`);
  return data;
}

/** A numeric reference is an ID; anything else must match a library name exactly, ignoring case. */
export async function resolveLibrary(
  client: CoreClient,
  nameOrId: string | number,
  opts: Opts = {},
): Promise<VideoLibraryModel> {
  const ref = String(nameOrId).trim();
  if (!ref) throw new UserError("A library name or ID is required.");
  if (/^\d+$/.test(ref)) return fetchLibrary(client, Number(ref), opts);

  // page must be >= 1: at page 0 the endpoint answers with a bare array instead of the { Items } envelope.
  const { data } = await client.GET("/videolibrary", {
    params: { query: { page: 1, search: ref, perPage: 1000 } },
    signal: opts.signal,
  });
  const match = (data?.Items ?? []).find(
    (lib) => (lib.Name ?? "").toLowerCase() === ref.toLowerCase(),
  );
  if (!match?.Id) {
    throw new UserError(
      `No video library found for "${ref}".`,
      "Check the name, or pass the library ID.",
    );
  }
  return fetchLibrary(client, match.Id, opts);
}

/** The account that owns the API key; library IDs are only unique within it. */
export async function fetchAccountId(
  client: CoreClient,
  opts: Opts = {},
): Promise<string> {
  const { data } = await client.GET("/user", { signal: opts.signal });
  if (!data?.AccountId) {
    throw new UserError(
      "Could not determine the bunny.net account for this API key.",
      "The bunny.net API key may be invalid or expired; check it or authenticate again.",
    );
  }
  return data.AccountId;
}
