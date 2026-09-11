import { expect, test } from "bun:test";
import type { Logger } from "@bunny.net/stream-import";
import { resolveSourceConfig } from "@bunny.net/stream-import";
import {
  findSource,
  requireSource,
  SOURCE_IDS,
  SOURCES,
} from "./import-sources.ts";

const noopLogger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
};

test("registers seven platforms with unique ids, dedup tags, and env vars, each adapter in step with its plugin", () => {
  expect(SOURCE_IDS).toEqual([
    "vimeo",
    "s3",
    "wistia",
    "mux",
    "cloudflare",
    "jwplayer",
    "brightcove",
  ]);
  // A shared dedup tag would make two sources skip each other's videos as already imported.
  expect(new Set(SOURCES.map((s) => s.dedupTag)).size).toBe(SOURCES.length);

  for (const plugin of SOURCES) {
    const envNames = plugin.credentials.map((c) => c.env);
    expect(new Set(envNames).size, plugin.id).toBe(envNames.length);

    const config = Object.fromEntries(
      plugin.credentials.map((f) => [f.key, "x"]),
    );
    const adapter = plugin.createAdapter(
      { ...config, region: "us-east-1", bucket: "test-bucket" },
      { userAgent: "test", requestTimeout: 1000, logger: noopLogger },
    );
    expect(adapter.id, plugin.id).toBe(plugin.id);
    expect(adapter.dedupTag, plugin.id).toBe(plugin.dedupTag);
  }
});

test("every source resolves its credentials from the documented environment variables", () => {
  const cases: Array<
    [string, Record<string, string>, Record<string, unknown>]
  > = [
    ["vimeo", { VIMEO_ACCESS_TOKEN: "vt" }, { accessToken: "vt" }],
    [
      "s3",
      {
        AWS_DEFAULT_REGION: "ap-south-1",
        S3_BUCKET: "b",
        S3_PRESIGNED_URL_TTL: "3600",
      },
      { region: "ap-south-1", bucket: "b", presignedUrlTtl: 3600 },
    ],
    ["wistia", { WISTIA_ACCESS_TOKEN: "wt" }, { accessToken: "wt" }],
    [
      "mux",
      { MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "sec" },
      { tokenId: "id", tokenSecret: "sec" },
    ],
    [
      "cloudflare",
      { CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" },
      { apiToken: "tok", accountId: "acc" },
    ],
    [
      "jwplayer",
      { JWPLAYER_API_KEY: "k", JWPLAYER_SITE_ID: "s" },
      { apiKey: "k", siteId: "s" },
    ],
    [
      "brightcove",
      {
        BRIGHTCOVE_CLIENT_ID: "ci",
        BRIGHTCOVE_CLIENT_SECRET: "cs",
        BRIGHTCOVE_ACCOUNT_ID: "ai",
      },
      { clientId: "ci", clientSecret: "cs", accountId: "ai" },
    ],
  ];
  for (const [id, env, expected] of cases) {
    expect(resolveSourceConfig(requireSource(id), { env }), id).toMatchObject(
      expected,
    );
  }
});

test("requireSource names the alternatives for an unknown or missing id", () => {
  expect(requireSource("vimeo").label).toBe("Vimeo");
  expect(findSource("nope")).toBeUndefined();
  expect(() => requireSource(undefined)).toThrow(/No source selected/);
  try {
    requireSource("youtube");
    expect.unreachable();
  } catch (error) {
    expect((error as { hint?: string }).hint).toContain("vimeo, s3");
  }
});
