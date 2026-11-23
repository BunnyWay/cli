import { afterEach, expect, setSystemTime, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import {
  type CoreClient,
  createToolContext,
  type StreamClient,
} from "@/tools/context.ts";
import {
  signPreviewToken,
  streamLivePreview,
  streamLivePreviewSign,
} from "./index.ts";

const ID = "0f4e5d6c-0000-0000-0000-000000000001";

afterEach(() => setSystemTime());

function context(
  routes: Record<string, unknown | (() => unknown)>,
  library: Record<string, unknown> = {},
) {
  const answer = (key: string) => {
    const route = routes[key];
    if (typeof route !== "function") return Promise.resolve({ data: route });
    try {
      return Promise.resolve({ data: route() });
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const stream = {
    GET: (path: string) => answer(`GET ${path}`),
  } as unknown as StreamClient;
  const core = {
    GET: () =>
      Promise.resolve({
        data: { Id: 12345, Name: "lib", ApiKey: "library-key", ...library },
      }),
  } as unknown as CoreClient;
  return createToolContext({
    clients: { core, streamLibrary: () => stream },
  });
}

test("signPreviewToken matches the documented Python reference", () => {
  // From the docs' snippet with stream_key=bunnylive_testkey, expires=1800000000.
  expect(signPreviewToken("bunnylive_testkey", ID, 1_800_000_000)).toBe(
    "HS256-cpnEzeBbW4Zh5rB2V6oOqSAwm_HNaHGP9eSkfe4RHSY",
  );
  // The GUID is signed lowercase.
  expect(
    signPreviewToken("bunnylive_testkey", ID.toUpperCase(), 1_800_000_000),
  ).toBe(signPreviewToken("bunnylive_testkey", ID, 1_800_000_000));
});

test("option 1 builds the player URLs from the API's query string", async () => {
  const ctx = context({
    "GET /library/{libraryId}/live/{streamId}/preview": {
      playlistUrl: "https://vz-1.b-cdn.net/preview/playlist.m3u8?token=cdn",
      playerQueryParameters:
        "previewToken=HS256-abc&previewExpires=1800000000&token=view&expires=1800000000",
      expiresAt: "2027-01-15T08:00:00Z",
    },
  });
  const access = await streamLivePreview.invoke(ctx, {
    library: 12345,
    stream: ID,
  });
  expect(access).toMatchObject({
    method: "api",
    playerUrl: `https://player.mediadelivery.net/embed/12345/${ID}?previewToken=HS256-abc&previewExpires=1800000000&token=view&expires=1800000000`,
    playUrl: `https://player.mediadelivery.net/play/12345/${ID}?previewToken=HS256-abc&previewExpires=1800000000&token=view&expires=1800000000`,
    playlistUrl: "https://vz-1.b-cdn.net/preview/playlist.m3u8?token=cdn",
    viewTokenMissing: false,
  });
});

test("option 1 explains a 409: the stream is public or ended", async () => {
  const ctx = context({
    "GET /library/{libraryId}/live/{streamId}/preview": () => {
      throw new ApiError("Conflict", 409);
    },
  });
  await expect(
    streamLivePreview.invoke(ctx, { library: 12345, stream: ID }),
  ).rejects.toThrow("already public or has ended");
});

test("option 2 signs with the stream key and flags a missing view token", async () => {
  setSystemTime(new Date(1_799_996_400_000)); // expires = now + 3600 = 1800000000
  const ctx = context(
    {
      "GET /library/{libraryId}/live/{streamId}": {
        guid: ID.toUpperCase(),
        title: "Keynote",
        status: 3,
        streamKey: "bunnylive_testkey",
      },
    },
    { PlayerTokenAuthenticationEnabled: true },
  );
  const access = await streamLivePreviewSign.invoke(ctx, {
    library: 12345,
    stream: ID,
  });
  expect(access).toEqual({
    id: ID,
    libraryId: 12345,
    method: "signed",
    playerUrl: `https://player.mediadelivery.net/embed/12345/${ID}?previewToken=HS256-cpnEzeBbW4Zh5rB2V6oOqSAwm_HNaHGP9eSkfe4RHSY&previewExpires=1800000000`,
    playUrl: `https://player.mediadelivery.net/play/12345/${ID}?previewToken=HS256-cpnEzeBbW4Zh5rB2V6oOqSAwm_HNaHGP9eSkfe4RHSY&previewExpires=1800000000`,
    playerQuery:
      "previewToken=HS256-cpnEzeBbW4Zh5rB2V6oOqSAwm_HNaHGP9eSkfe4RHSY&previewExpires=1800000000",
    playlistUrl: null,
    expiresAt: "2027-01-15T08:00:00.000Z",
    viewTokenMissing: true,
  });
});

test("option 2 refuses a public stream, a redacted key, and an expiry over 10h05m", async () => {
  const running = context({
    "GET /library/{libraryId}/live/{streamId}": {
      guid: ID,
      title: "Keynote",
      status: 4,
      streamKey: "k",
    },
  });
  await expect(
    streamLivePreviewSign.invoke(running, { library: 12345, stream: ID }),
  ).rejects.toThrow("it is live");

  const redacted = context({
    "GET /library/{libraryId}/live/{streamId}": {
      guid: ID,
      title: "Keynote",
      status: 1,
      streamKey: "",
    },
  });
  await expect(
    streamLivePreviewSign.invoke(redacted, { library: 12345, stream: ID }),
  ).rejects.toThrow("No stream key available");

  await expect(
    streamLivePreviewSign.invoke(redacted, {
      library: 12345,
      stream: ID,
      expiresIn: 36_301,
    }),
  ).rejects.toThrow("expiresIn");
});
