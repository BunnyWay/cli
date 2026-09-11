import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { SourcePlugin } from "./contracts.ts";
import {
  describeSource,
  missingCredentials,
  parseSourceConfig,
  resolveSourceConfig,
} from "./credentials.ts";
import { assertFolderSupported } from "./source-plugin.ts";

const plugin: SourcePlugin = {
  id: "fake",
  label: "Fake",
  dedupTag: "fakeId",
  supportsFolders: false,
  credentials: [
    {
      key: "token",
      label: "Token",
      env: "FAKE_TOKEN",
      secret: true,
      required: true,
    },
    {
      key: "account",
      label: "Account",
      env: "FAKE_ACCOUNT",
      fallbackEnv: ["FAKE_ACCT"],
      secret: false,
      required: true,
    },
    {
      key: "region",
      label: "Region",
      env: "FAKE_REGION",
      secret: false,
      required: true,
      default: "eu",
    },
    {
      key: "ttl",
      label: "TTL",
      env: "FAKE_TTL",
      secret: false,
      required: false,
      type: "number",
    },
  ],
  configSchema: z.object({
    token: z.string().min(1),
    account: z.string().min(1),
    region: z.string(),
    ttl: z.number().optional(),
  }),
  createAdapter: () => {
    throw new Error("unused");
  },
};

describe("resolveSourceConfig", () => {
  test("reads env vars with fallbacks and defaults, coerces numbers, and lets overrides win", () => {
    expect(
      resolveSourceConfig(plugin, {
        env: { FAKE_TOKEN: "t", FAKE_ACCT: "a", FAKE_TTL: "3600" },
        overrides: { account: "flagged" },
      }),
    ).toEqual({ token: "t", account: "flagged", region: "eu", ttl: 3600 });
    expect(
      resolveSourceConfig(plugin, { env: {}, includeDefaults: false }),
    ).toEqual({});
    expect(() =>
      resolveSourceConfig(plugin, { env: { FAKE_TTL: "soon" } }),
    ).toThrow(/TTL must be a number/);
  });
});

describe("describeSource and parseSourceConfig", () => {
  test("reports readiness without a default masquerading as configuration, and names missing fields by env var", () => {
    expect(
      describeSource(plugin, { FAKE_TOKEN: "t", FAKE_ACCOUNT: "a" }).readiness,
    ).toBe("ready");
    // Only the defaulted region resolves here, so nothing has really been configured.
    expect(describeSource(plugin, {}).readiness).toBe("unconfigured");

    const partial = describeSource(plugin, { FAKE_TOKEN: "t" });
    expect(partial.readiness).toBe("partial");
    expect(partial.missing.map((f) => f.env)).toEqual(["FAKE_ACCOUNT"]);

    const resolved = resolveSourceConfig(plugin, { env: {} });
    expect(missingCredentials(plugin, resolved).map((f) => f.key)).toEqual([
      "token",
      "account",
    ]);
    expect(() => parseSourceConfig(plugin, resolved)).toThrow(
      /Fake is not configured: Token \(FAKE_TOKEN\), Account \(FAKE_ACCOUNT\)/,
    );
  });
});

test("assertFolderSupported rejects --folder on a flat source and says nothing otherwise", () => {
  expect(() => assertFolderSupported(plugin, undefined)).not.toThrow();
  expect(() =>
    assertFolderSupported({ ...plugin, supportsFolders: true }, "f1"),
  ).not.toThrow();
  expect(() => assertFolderSupported(plugin, "f1")).toThrow(/has no folders/);
});
