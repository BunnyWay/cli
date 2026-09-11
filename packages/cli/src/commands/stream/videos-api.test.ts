import { afterEach, expect, test } from "bun:test";
import type { ResolvedConfig } from "@/config/index.ts";
import type { VideoLibraryModel } from "./api.ts";
import { connectStreamLibrary, formatDuration } from "./videos-api.ts";

const CONFIG: ResolvedConfig = {
  apiKey: "account-key",
  // The core API host must not leak into the Stream client.
  apiUrl: "https://api.bunny.net",
  profile: "default",
};

const LIBRARY: VideoLibraryModel = {
  Id: 4321,
  Name: "my-library",
  ApiKey: "library-key",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("connectStreamLibrary requires the library's own API key", () => {
  expect(() =>
    connectStreamLibrary({ ...LIBRARY, ApiKey: undefined }, { config: CONFIG }),
  ).toThrow(/No API key available for video library my-library/);
});

test("connectStreamLibrary targets the Stream host with the library key", async () => {
  let request: Request | undefined;
  globalThis.fetch = (async (input: Request) => {
    request = input;
    return new Response("{}", {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const client = connectStreamLibrary(LIBRARY, { config: CONFIG });
  await client.GET("/library/{libraryId}/videos/{videoId}", {
    params: { path: { libraryId: 4321, videoId: "video-guid" } },
  });

  expect(request?.url).toBe(
    "https://video.bunnycdn.com/library/4321/videos/video-guid",
  );
  // The per-library key authenticates, not the account key from the config.
  expect(request?.headers.get("AccessKey")).toBe("library-key");
});

test("formatDuration renders m:ss, and h:mm:ss past an hour", () => {
  expect(formatDuration(0)).toBe("0:00");
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(599)).toBe("9:59");
  expect(formatDuration(3600)).toBe("1:00:00");
  expect(formatDuration(3725)).toBe("1:02:05");
  expect(formatDuration(59.6)).toBe("1:00");
});

test("formatDuration dashes an unknown or nonsense length", () => {
  expect(formatDuration(undefined)).toBe("—");
  expect(formatDuration(null)).toBe("—");
  expect(formatDuration(-1)).toBe("—");
  expect(formatDuration(Number.NaN)).toBe("—");
});
