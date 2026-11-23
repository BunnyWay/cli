import { expect, test } from "bun:test";
import { ApiError } from "@bunny.net/openapi-client";
import {
  type CoreClient,
  createToolContext,
  type StreamClient,
} from "@/tools/context.ts";
import {
  COUNTRIES,
  COUNTRY_CODES,
  expandGeoPresets,
  GEO_PRESETS,
  parseCountryCodes,
  playerUpdateBody,
  streamGeoBlockingUpdate,
  streamLibraryUsage,
  streamVideoStorage,
  streamWatermarkSet,
  toPlayerSettings,
  toVideoStorage,
} from "./index.ts";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  headers?: unknown;
}

const LIBRARY = {
  Id: 12345,
  Name: "lib",
  ApiKey: "library-key",
  PullZoneId: 77,
  HasWatermark: true,
};

/** Fake core and Stream clients answering by "METHOD path". */
function setup(
  routes: Record<string, unknown | (() => unknown)>,
  library: Record<string, unknown> = {},
) {
  const calls: Call[] = [];
  const answer =
    (method: string) =>
    (path: string, init: { body?: unknown; headers?: unknown } = {}) => {
      calls.push({ method, path, body: init.body, headers: init.headers });
      if (method === "GET" && path === "/videolibrary/{id}")
        return Promise.resolve({ data: { ...LIBRARY, ...library } });
      if (method === "GET" && path === "/user")
        return Promise.resolve({ data: { AccountId: "acc" } });
      const route = routes[`${method} ${path}`];
      if (typeof route !== "function") return Promise.resolve({ data: route });
      try {
        return Promise.resolve({ data: route() });
      } catch (err) {
        return Promise.reject(err);
      }
    };
  const client = {
    GET: answer("GET"),
    POST: answer("POST"),
    PUT: answer("PUT"),
    DELETE: answer("DELETE"),
  };
  const ctx = createToolContext({
    clients: {
      core: client as unknown as CoreClient,
      streamLibrary: () => client as unknown as StreamClient,
    },
  });
  return { ctx, calls };
}

test("the country list matches the docs: 249 entries, GB and XK, no Antarctica", () => {
  expect(COUNTRIES).toHaveLength(249);
  expect(new Set(COUNTRY_CODES).size).toBe(249);
  expect(COUNTRY_CODES).toContain("GB");
  expect(COUNTRY_CODES).toContain("XK");
  expect(COUNTRY_CODES).not.toContain("AQ");
  expect(COUNTRY_CODES).not.toContain("UK");
});

test("parseCountryCodes accepts UK for GB and rejects unsupported codes", () => {
  expect(parseCountryCodes(["us, uk", "US"])).toEqual(["US", "GB"]);
  expect(() => parseCountryCodes(["AQ"])).toThrow("Unsupported country code");
  expect(() => parseCountryCodes(["EU"])).toThrow("Unsupported country code");
});

test("geo-blocking block/unblock edits the Pull Zone's current list", async () => {
  let blocked = ["RU"];
  const { ctx, calls } = setup({
    "GET /pullzone/{id}": () => ({ BlockedCountries: blocked }),
    "POST /pullzone/{id}": () => {
      blocked = (calls.at(-1)?.body as { BlockedCountries: string[] })
        .BlockedCountries;
      return {};
    },
  });
  const result = await streamGeoBlockingUpdate.invoke(ctx, {
    library: 12345,
    block: ["CN", "kp"],
    unblock: ["RU"],
  });
  expect(result.blocked).toEqual(["CN", "KP"]);
  expect(result.pullZoneId).toBe(77);
});

test("geo-blocking allowOnly blocks every other supported country", async () => {
  const { ctx, calls } = setup({
    "GET /pullzone/{id}": { BlockedCountries: [] },
  });
  await streamGeoBlockingUpdate.invoke(ctx, {
    library: 12345,
    allowOnly: ["GB", "IE"],
  });
  const sent = (
    calls.find((c) => c.method === "POST")?.body as {
      BlockedCountries: string[];
    }
  ).BlockedCountries;
  expect(sent).toHaveLength(247);
  expect(sent).not.toContain("GB");
  expect(sent).not.toContain("IE");
});

test("geo presets match the docs and cover every country once by continent", () => {
  const sizes = Object.fromEntries(
    Object.entries(GEO_PRESETS).map(([id, p]) => [id, p.codes.length]),
  );
  expect(sizes).toEqual({
    africa: 60,
    asia: 50,
    europe: 53,
    "north-america": 41,
    oceania: 29,
    "south-america": 16,
    eu: 27,
    eea: 30,
    "eea-uk": 31,
    apac: 55,
    anz: 2,
    benelux: 3,
    dach: 3,
    latam: 21,
    mena: 20,
    nordics: 8,
    "uk-ireland": 5,
    "us-canada": 7,
  });
  const continents = expandGeoPresets([
    "africa,asia,europe",
    "north-america,oceania,south-america",
  ]);
  expect(continents.sort()).toEqual([...COUNTRY_CODES].sort());
  for (const preset of Object.values(GEO_PRESETS))
    for (const code of preset.codes) expect(COUNTRY_CODES).toContain(code);
  expect(() => expandGeoPresets(["gdpr"])).toThrow(
    "Unknown geo-blocking preset",
  );
});

test("geo-blocking presets add to the list of the chosen mode", async () => {
  const sent = async (input: Record<string, unknown>) => {
    const { ctx, calls } = setup({
      "GET /pullzone/{id}": { BlockedCountries: ["RU"] },
    });
    await streamGeoBlockingUpdate.invoke(ctx, { library: 12345, ...input });
    return (
      calls.find((c) => c.method === "POST")?.body as {
        BlockedCountries: string[];
      }
    ).BlockedCountries;
  };
  // On their own, presets add to the current block list.
  expect((await sent({ presets: ["benelux"] })).sort()).toEqual([
    "BE",
    "LU",
    "NL",
    "RU",
  ]);
  // With allowOnly, the preset is what stays allowed.
  const allowEea = await sent({ allowOnly: [], presets: ["eea-uk"] });
  expect(allowEea).toHaveLength(249 - 31);
  expect(allowEea).not.toContain("GB");
  expect(allowEea).not.toContain("NO");
  // With set, the preset and the codes replace the list.
  expect((await sent({ set: ["US"], presets: ["dach"] })).sort()).toEqual([
    "AT",
    "CH",
    "DE",
    "US",
  ]);
});

test("geo-blocking refuses mixed modes", async () => {
  const { ctx } = setup({});
  await expect(
    streamGeoBlockingUpdate.invoke(ctx, {
      library: 12345,
      block: ["US"],
      clear: true,
    }),
  ).rejects.toThrow("exactly one of");
});

test("watermark positioning needs an existing watermark", async () => {
  const { ctx } = setup({}, { HasWatermark: false });
  await expect(
    streamWatermarkSet.invoke(ctx, { library: 12345, top: 80 }),
  ).rejects.toThrow("has no watermark to position");
});

test("watermark positioning sends only the given fields", async () => {
  const { ctx, calls } = setup({});
  await streamWatermarkSet.invoke(ctx, { library: 12345, left: 90, top: 5 });
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({
    WatermarkPositionLeft: 90,
    WatermarkPositionTop: 5,
  });
});

test("VAST tag URL round-trips through the player settings", () => {
  expect(
    playerUpdateBody({ vastUrl: "https://ads.example.com/vast.xml" }),
  ).toEqual({
    VastTagUrl: "https://ads.example.com/vast.xml",
  });
  expect(playerUpdateBody({ vastUrl: "" })).toEqual({ VastTagUrl: "" });
  expect(toPlayerSettings({ VastTagUrl: "https://a/v" }).vastUrl).toBe(
    "https://a/v",
  );
  expect(toPlayerSettings({ VastTagUrl: "" }).vastUrl).toBeNull();
});

test("toVideoStorage totals renditions and parts, largest rendition first", () => {
  const storage = toVideoStorage(1, "v", {
    encoded: {
      "720p-h264": { codec: "h264", resolution: "720p", size: 100 },
      "1080p-av1": { codec: "av1", resolution: "1080p", size: 300 },
    },
    originals: 1000,
    mp4Fallback: 50,
    thumbnails: 5,
    previews: 10,
    miscellaneous: 2,
  });
  expect(storage.totalBytes).toBe(1467);
  expect(storage.renditions.map((r) => r.codec)).toEqual(["av1", "h264"]);
});

test("stream.videos.storage reads the status envelope and names a missing video", async () => {
  const { ctx } = setup({
    "GET /library/{libraryId}/videos/{videoId}/storage": {
      success: true,
      data: { originals: 10 },
    },
  });
  const storage = await streamVideoStorage.invoke(ctx, {
    library: 12345,
    video: "v",
  });
  expect(storage.originalBytes).toBe(10);

  const missing = setup({
    "GET /library/{libraryId}/videos/{videoId}/storage": () => {
      throw new ApiError("Not Found", 404);
    },
  });
  await expect(
    streamVideoStorage.invoke(missing.ctx, { library: 12345, video: "v" }),
  ).rejects.toThrow("Video v not found.");
});

test("usage estimates costs and reports sections it couldn't read", async () => {
  const { ctx } = setup({
    "GET /library/{libraryId}/statistics/encoding": {
      premium: {
        normalizedTotal: 1200,
        outputTotal: 600,
        byVideoCodec: { AV1: { normalized: 1200, output: 600 } },
      },
      free: { normalizedTotal: 0, outputTotal: 300 },
    },
    "GET /videolibrary/{id}/transcribing/statistics": {
      TotalTranscriptionSeconds: 600,
    },
    "GET /videolibrary/{id}/drm/statistics": { TotalLicensesIssued: 42 },
    "GET /library/{libraryId}/live/statistics/encoding": () => {
      throw new ApiError("Unavailable", 503);
    },
  });
  const usage = await streamLibraryUsage.invoke(ctx, { library: 12345 });
  expect(usage.encoding?.estimatedCost).toBe(1); // 20 billable min x $0.05
  expect(usage.encoding?.premium.byCodec.AV1).toEqual({
    billable: 1200,
    output: 600,
  });
  expect(usage.transcribing).toEqual({ seconds: 600, estimatedCost: 1 });
  expect(usage.drm).toEqual({ licenses: 42 });
  expect(usage.live).toBeNull();
  expect(usage.unavailable).toEqual({ live: "not available right now" });
});
