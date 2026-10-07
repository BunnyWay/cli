import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import { type CoreClient, createToolContext } from "../context.ts";
import {
  assertLanguages,
  parseReplicationRegions,
  playerUpdateBody,
  streamLibrariesAddRegions,
  streamLibrariesRotateKey,
  streamPlayerUpdate,
  streamSecurityGet,
  streamSecurityTokenKey,
  streamSecurityUpdate,
  toPlayerSettings,
} from "./index.ts";

interface Call {
  method: "GET" | "POST";
  path: string;
  id?: number;
  body?: unknown;
}

/** A fake core client: GET answers from `routes`, POST is recorded (and can fail by path). */
function fakeCore(
  routes: Record<string, unknown>,
  opts: { failPost?: (path: string, body: unknown) => Error | undefined } = {},
) {
  const calls: Call[] = [];
  const core = {
    GET: (path: string, init?: { params?: { path?: { id?: number } } }) => {
      calls.push({ method: "GET", path, id: init?.params?.path?.id });
      return Promise.resolve({ data: routes[path] });
    },
    POST: (
      path: string,
      init?: { params?: { path?: { id?: number } }; body?: unknown },
    ) => {
      calls.push({
        method: "POST",
        path,
        id: init?.params?.path?.id,
        body: init?.body,
      });
      const error = opts.failPost?.(path, init?.body);
      if (error) return Promise.reject(error);
      return Promise.resolve({ data: routes[`POST ${path}`] });
    },
  } as unknown as CoreClient;
  return { core, calls, ctx: createToolContext({ clients: { core } }) };
}

const LIBRARY = {
  Id: 12345,
  Name: "my-library",
  PullZoneId: 77,
  StorageZoneId: 88,
  ReplicationRegions: ["SG", "LA", "NY"],
  AllowedReferrers: ["example.com"],
  BlockedReferrers: [],
  DrmVersion: 0 as const,
};

test("parseReplicationRegions upper-cases, dedupes, drops DE, and rejects unknown codes", () => {
  expect(parseReplicationRegions(["de,sg", "SG", "syd"])).toEqual([
    "SG",
    "SYD",
  ]);
  expect(parseReplicationRegions(["DE"])).toEqual([]);
  expect(() => parseReplicationRegions(["SG", "XX"])).toThrow(
    "Invalid replication region(s): XX.",
  );
});

test("stream.libraries.addregions sends existing + new regions and never DE", async () => {
  const { ctx, calls } = fakeCore({ "/videolibrary/{id}": LIBRARY });
  const result = await streamLibrariesAddRegions.invoke(ctx, {
    library: 12345,
    regions: ["DE", "SYD", "SG"],
  });
  const post = calls.find((c) => c.method === "POST");
  expect(post).toMatchObject({
    path: "/storagezone/{id}",
    id: 88,
    body: { ReplicationZones: ["SG", "LA", "NY", "SYD"] },
  });
  expect(result).toEqual({
    library: 12345,
    storageZoneId: 88,
    added: ["SYD"],
    regions: ["DE", "SG", "LA", "NY", "SYD"],
  });
});

test("stream.libraries.addregions sends nothing when every region is already enabled", async () => {
  const { ctx, calls } = fakeCore({ "/videolibrary/{id}": LIBRARY });
  const result = await streamLibrariesAddRegions.invoke(ctx, {
    library: 12345,
    regions: ["sg"],
  });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  expect(result.added).toEqual([]);
});

test("stream.libraries.rotatekey re-reads the library for the new key", async () => {
  const { ctx, calls } = fakeCore({
    "/videolibrary/{id}": { ...LIBRARY, ReadOnlyApiKey: "new-ro-key" },
  });
  const result = await streamLibrariesRotateKey.invoke(ctx, {
    library: 12345,
    readOnly: true,
  });
  expect(calls[0]).toMatchObject({
    method: "POST",
    path: "/videolibrary/{id}/resetReadOnlyApiKey",
  });
  expect(calls[1]).toMatchObject({ method: "GET", path: "/videolibrary/{id}" });
  expect(result).toEqual({
    library: 12345,
    readOnly: true,
    apiKey: "new-ro-key",
  });
});

test('playerUpdateBody maps changes, and controls: false sends "0"', () => {
  expect(
    playerUpdateBody({
      controls: false,
      speeds: ["1.0", "1.15"],
      playerVersion: 1,
      compactControls: true,
    }),
  ).toEqual({
    Controls: "0",
    PlaybackSpeeds: "1.0,1.15",
    PlayerVersion: 1,
    EnableCompactControls: true,
  });
  expect(toPlayerSettings({ Id: 1, Controls: "0" })).toMatchObject({
    controlsEnabled: false,
    controls: [],
  });
});

test("stream.player.update checks the UI language against the supported list", async () => {
  const { ctx, calls } = fakeCore({
    "/videolibrary/languages": [
      { ShortCode: "en", Name: "English", SupportPlayerTranslation: true },
      { ShortCode: "xx", Name: "Other", SupportPlayerTranslation: false },
    ],
  });
  await expect(
    streamPlayerUpdate.invoke(ctx, {
      library: 12345,
      changes: { language: "xx" },
    }),
  ).rejects.toThrow("Unsupported player UI language(s): xx.");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("stream.security.get reads CDN token state from the linked Pull Zone", async () => {
  const { ctx } = fakeCore({
    "/videolibrary/{id}": {
      ...LIBRARY,
      PlayerTokenAuthenticationEnabled: true,
    },
    "/pullzone/{id}": {
      ZoneSecurityEnabled: true,
      ZoneSecurityIncludeHashRemoteIP: false,
      ZoneSecurityKey: "secret",
    },
  });
  const security = await streamSecurityGet.invoke(ctx, { library: 12345 });
  expect(security).toMatchObject({
    embedToken: true,
    cdnToken: true,
    tokenIp: false,
    allowedDomains: ["example.com"],
    drm: { enabled: false, version: "basic" },
  });
  expect(JSON.stringify(security)).not.toContain("secret");
});

test("stream.security.update sends settings once, skips no-ops, and stops at the first failure", async () => {
  const { ctx, calls } = fakeCore(
    { "/videolibrary/{id}": LIBRARY, "POST /videolibrary/{id}": LIBRARY },
    {
      failPost: (path, body) =>
        path.endsWith("addAllowedReferrer") &&
        (body as { Hostname: string }).Hostname === "bad.example.com"
          ? new ApiError("Bad Request", 400)
          : undefined,
    },
  );
  const result = await streamSecurityUpdate.invoke(ctx, {
    library: 12345,
    settings: { embedToken: true, drmBasic: true },
    referrers: {
      allow: ["example.com", "bad.example.com", "app.example.com"],
      block: ["spam.example.com"],
    },
  });

  const posts = calls.filter((c) => c.method === "POST");
  expect(posts[0]).toMatchObject({
    path: "/videolibrary/{id}",
    body: {
      PlayerTokenAuthenticationEnabled: true,
      EnableDRM: true,
      DrmVersion: 0,
    },
  });
  expect(posts).toHaveLength(2);
  expect(result.complete).toBe(false);
  expect(result.changes.map((c) => [c.change, c.status])).toEqual([
    [
      "settings (PlayerTokenAuthenticationEnabled, EnableDRM, DrmVersion)",
      "applied",
    ],
    ["allow example.com", "skipped"],
    ["allow bad.example.com", "failed"],
    ["allow app.example.com", "notAttempted"],
    ["block spam.example.com", "notAttempted"],
  ]);
});

test("stream.security.update refuses DRM changes on an Enterprise DRM library", async () => {
  const { ctx, calls } = fakeCore({
    "/videolibrary/{id}": { ...LIBRARY, DrmVersion: 1 },
  });
  await expect(
    streamSecurityUpdate.invoke(ctx, {
      library: 12345,
      settings: { drmBasic: false },
    }),
  ).rejects.toThrow("uses MediaCage Enterprise DRM");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("stream.security.tokenkey reads ZoneSecurityKey from the linked Pull Zone", async () => {
  const { ctx } = fakeCore({
    "/videolibrary/{id}": LIBRARY,
    "/pullzone/{id}": { ZoneSecurityKey: "secret" },
  });
  expect(await streamSecurityTokenKey.invoke(ctx, { library: 12345 })).toEqual({
    library: 12345,
    pullZoneId: 77,
    key: "secret",
  });
});

test("assertLanguages checks transcription languages case-insensitively", () => {
  const languages = [
    { code: "en", name: "English", player: true, transcribing: true },
    { code: "mk", name: "Macedonian", player: true, transcribing: false },
  ];
  expect(() =>
    assertLanguages(["EN"], languages, "transcribing"),
  ).not.toThrow();
  expect(() =>
    assertLanguages(["en", "mk"], languages, "transcribing"),
  ).toThrow("Unsupported transcription language(s): mk.");
});
