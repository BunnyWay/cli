import { describe, expect, test } from "bun:test";
import {
  type CoreClient,
  fetchLibraries,
  fetchLibrary,
  resolveLibrary,
  toSafeVideoLibrary,
  type VideoLibraryModel,
} from "./api.ts";

interface Call {
  method: string;
  path: string;
  params?: Record<string, unknown>;
}

/**
 * Path-branching fake core client (same shape as sites/api.test.ts): only the
 * /videolibrary endpoints the stream commands touch are implemented.
 *
 * GET /videolibrary is modelled on the spec: the { Items, ... } envelope only
 * appears when `page` is greater than 0; without it the endpoint answers with
 * a plain array, which is what made an omitted `page` silently match nothing.
 */
function fakeCoreClient(opts: {
  calls: Call[];
  libraries?: VideoLibraryModel[];
  /** Split the listing across pages so HasMoreItems paging is exercised. */
  pageSize?: number;
}): CoreClient {
  const libraries = opts.libraries ?? [];
  return {
    GET: async (
      path: string,
      options?: {
        params?: {
          path?: { id?: number };
          query?: { page?: number; perPage?: number; search?: string };
        };
      },
    ) => {
      opts.calls.push({ method: "GET", path, params: options?.params });
      if (path === "/videolibrary/{id}") {
        return {
          data: libraries.find((lib) => lib.Id === options?.params?.path?.id),
        };
      }
      if (path === "/videolibrary") {
        const search = options?.params?.query?.search;
        const matched = search
          ? libraries.filter((lib) =>
              (lib.Name ?? "").toLowerCase().includes(search.toLowerCase()),
            )
          : libraries;
        const page = options?.params?.query?.page ?? 0;
        // page 0 (or omitted) → plain array, no pagination envelope.
        if (page < 1) return { data: matched };
        const pageSize = opts.pageSize ?? Math.max(matched.length, 1);
        const start = (page - 1) * pageSize;
        return {
          data: {
            Items: matched.slice(start, start + pageSize),
            CurrentPage: page,
            TotalItems: matched.length,
            HasMoreItems: start + pageSize < matched.length,
          },
        };
      }
      throw new Error(`unexpected GET ${path}`);
    },
  } as unknown as CoreClient;
}

const LIBRARIES: VideoLibraryModel[] = [
  { Id: 2, Name: "zebra", VideoCount: 1 },
  { Id: 1, Name: "Alpha", VideoCount: 3 },
  { Id: 3, Name: "marketing", VideoCount: 0 },
];

test("fetchLibraries pages through the listing and sorts by name", async () => {
  const calls: Call[] = [];
  const client = fakeCoreClient({
    calls,
    libraries: LIBRARIES,
    pageSize: 2, // force a second page
  });

  const libraries = await fetchLibraries(client);

  expect(libraries.map((lib) => lib.Name)).toEqual([
    "Alpha",
    "marketing",
    "zebra",
  ]);
  const pages = calls
    .filter((c) => c.path === "/videolibrary")
    .map((c) => (c.params as { query: { page: number } }).query.page);
  expect(pages).toEqual([1, 2]);
});

test("fetchLibraries returns an empty list when the account has none", async () => {
  expect(await fetchLibraries(fakeCoreClient({ calls: [] }))).toEqual([]);
});

test("fetchLibrary throws a UserError when the ID does not exist", async () => {
  const client = fakeCoreClient({ calls: [], libraries: LIBRARIES });
  await expect(fetchLibrary(client, 99)).rejects.toThrow(
    "Video library 99 not found.",
  );
});

test("resolveLibrary treats numeric input as an ID", async () => {
  const calls: Call[] = [];
  const client = fakeCoreClient({ calls, libraries: LIBRARIES });

  const lib = await resolveLibrary(client, "3");

  expect(lib.Name).toBe("marketing");
  // Straight to the by-ID endpoint: no search listing.
  expect(calls.map((c) => c.path)).toEqual(["/videolibrary/{id}"]);
});

test("resolveLibrary matches a name case-insensitively and re-fetches by ID", async () => {
  const calls: Call[] = [];
  const client = fakeCoreClient({ calls, libraries: LIBRARIES });

  const lib = await resolveLibrary(client, "ALPHA");

  expect(lib.Id).toBe(1);
  expect(calls.map((c) => c.path)).toEqual([
    "/videolibrary",
    "/videolibrary/{id}",
  ]);
  const search = calls[0]?.params as {
    query: { search: string; page: number };
  };
  expect(search.query.search).toBe("ALPHA");
  // Regression: without page >= 1 the endpoint answers with a plain array,
  // data.Items is undefined, and every name lookup "finds" nothing.
  expect(search.query.page).toBeGreaterThanOrEqual(1);
});

// A search is a substring match server-side, so a partial hit must not be
// mistaken for the requested library.
test("resolveLibrary rejects a partial name match", async () => {
  const client = fakeCoreClient({ calls: [], libraries: LIBRARIES });
  await expect(resolveLibrary(client, "market")).rejects.toThrow(
    'No video library found for "market".',
  );
});

test("resolveLibrary requires a non-empty reference", async () => {
  const client = fakeCoreClient({ calls: [], libraries: LIBRARIES });
  await expect(resolveLibrary(client, "   ")).rejects.toThrow(
    "A library name or ID is required.",
  );
});

describe("toSafeVideoLibrary", () => {
  const library = {
    Id: 1,
    Name: "my-library",
    VideoCount: 3,
    ApiKey: "rw-secret",
    ReadOnlyApiKey: "ro-secret",
    // Deprecated, but the API still returns it and its value equals ApiKey.
    ApiAccessKey: "rw-secret",
    StorageUsage: 1024,
  } as VideoLibraryModel;

  test("drops every API key, including the deprecated ApiAccessKey", () => {
    const safe = toSafeVideoLibrary(library);
    expect("ApiKey" in safe).toBe(false);
    expect("ReadOnlyApiKey" in safe).toBe(false);
    expect("ApiAccessKey" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("secret");
  });

  test("preserves every non-secret field", () => {
    expect(toSafeVideoLibrary(library)).toEqual({
      Id: 1,
      Name: "my-library",
      VideoCount: 3,
      StorageUsage: 1024,
    } as VideoLibraryModel);
  });

  test("does not mutate the original library", () => {
    toSafeVideoLibrary(library);
    expect(library.ApiKey).toBe("rw-secret");
  });
});
