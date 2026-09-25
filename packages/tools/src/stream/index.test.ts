import { afterEach, expect, test } from "bun:test";
import { type CoreClient, createToolContext } from "../context.ts";
import type { VideoLibraryModel } from "./api.ts";
import { openStreamLibrary } from "./connect.ts";
import { streamLibrariesGet, streamLibrariesList } from "./index.ts";

const LIBRARIES: VideoLibraryModel[] = [
  { Id: 2, Name: "zebra", VideoCount: 1, ApiKey: "zebra-key" },
  { Id: 1, Name: "Alpha", VideoCount: 3, ApiKey: "alpha-key" },
  { Id: 3, Name: "marketing", VideoCount: 0 },
];

type Query = { page?: number; perPage?: number; search?: string };

// Modelled on the spec: without page >= 1 GET /videolibrary answers with a bare array, not the { Items } envelope.
function fakeCore(calls: string[] = [], pageSize = LIBRARIES.length) {
  const GET = async (
    path: string,
    opts?: { params?: { path?: { id?: number }; query?: Query } },
  ) => {
    const query = opts?.params?.query;
    calls.push(query?.search ? `${path}?search=${query.search}` : path);
    if (path === "/user") return { data: { AccountId: "acct" } };
    if (path === "/videolibrary/{id}")
      return { data: LIBRARIES.find((l) => l.Id === opts?.params?.path?.id) };
    const matched = LIBRARIES.filter((l) =>
      (l.Name ?? "")
        .toLowerCase()
        .includes((query?.search ?? "").toLowerCase()),
    );
    const page = query?.page ?? 0;
    if (page < 1) return { data: matched };
    const start = (page - 1) * pageSize;
    return {
      data: {
        Items: matched.slice(start, start + pageSize),
        HasMoreItems: start + pageSize < matched.length,
      },
    };
  };
  return { GET } as unknown as CoreClient;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("stream.libraries.list pages through the listing and sorts by name", async () => {
  const ctx = createToolContext({ clients: { core: fakeCore([], 2) } });
  const names = (await streamLibrariesList.invoke(ctx, {})).map((l) => l.name);
  expect(names).toEqual(["Alpha", "marketing", "zebra"]);
});

test("stream.libraries.get matches a whole name case-insensitively, never a substring", async () => {
  const calls: string[] = [];
  const ctx = createToolContext({ clients: { core: fakeCore(calls) } });

  expect(await streamLibrariesGet.invoke(ctx, { library: "ALPHA" })).toEqual({
    id: 1,
    name: "Alpha",
    videoCount: 3,
  });
  expect(calls).toEqual(["/videolibrary?search=ALPHA", "/videolibrary/{id}"]);
  await expect(
    streamLibrariesGet.invoke(ctx, { library: "market" }),
  ).rejects.toThrow('No video library found for "market".');
});

test("openStreamLibrary talks to the Stream host with the library's own key", async () => {
  let request: Request | undefined;
  globalThis.fetch = (async (input: Request) => {
    request = input;
    return Response.json({});
  }) as unknown as typeof fetch;
  // The account key and core API host must not reach the Stream client.
  const ctx = createToolContext({
    apiKey: "account-key",
    apiUrl: "https://api.example.test",
    clients: { core: fakeCore() },
  });

  const { library, accountId, client } = await openStreamLibrary(ctx, "1");
  await client.GET("/library/{libraryId}/videos/{videoId}", {
    params: { path: { libraryId: 1, videoId: "guid" } },
  });

  expect({ library, accountId }).toEqual({
    library: { id: 1, name: "Alpha", videoCount: 3 },
    accountId: "acct",
  });
  expect(request?.url).toBe("https://video.bunnycdn.com/library/1/videos/guid");
  expect(request?.headers.get("AccessKey")).toBe("alpha-key");
  await expect(openStreamLibrary(ctx, 3)).rejects.toThrow(
    /No API key available for video library marketing/,
  );
});
