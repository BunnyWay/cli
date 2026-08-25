import { expect, test } from "bun:test";
import type { BuildManifest } from "@bunny.net/config";
import type { CoreClient, StorageZoneModel } from "../../storage/api.ts";
import { applyScriptEnv, resolveScriptEnv } from "./env.ts";
import { applyPullZoneSettings, deployPreamble } from "./publish.ts";
import type { ComputeClient } from "./resources.ts";
import { storageHostFor } from "./storage.ts";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

test("storageHostFor maps a region to its endpoint", () => {
  expect(storageHostFor("DE")).toBe("storage.bunnycdn.com");
  expect(storageHostFor("de")).toBe("storage.bunnycdn.com");
  expect(storageHostFor("NY")).toBe("ny.storage.bunnycdn.com");
  expect(storageHostFor("syd")).toBe("syd.storage.bunnycdn.com");
  // A zone with no region reported is the default one.
  expect(storageHostFor(null)).toBe("storage.bunnycdn.com");
});

// The preamble is what keeps a release and its files together.
test("deployPreamble writes the deploy onto globalThis", () => {
  const line = deployPreamble({
    id: "a1b2c3d4",
    assetPrefix: "deploys/a1b2c3d4",
    site: "my-site",
    environment: "production",
  });
  expect(line).toBe(
    'globalThis.__BUNNY_DEPLOY__ = {"id":"a1b2c3d4","assetPrefix":"deploys/a1b2c3d4","site":"my-site","environment":"production"};\n',
  );
  // It is one line, so a source map's line numbers shift by exactly one.
  expect(line.split("\n")).toHaveLength(2);
});

function fakePullZoneClient(
  calls: Call[],
  zone: Record<string, unknown>,
): CoreClient {
  return {
    GET: async (path: string) => {
      calls.push({ method: "GET", path });
      return { data: zone };
    },
    POST: async (path: string, init?: { body?: unknown }) => {
      calls.push({ method: "POST", path, body: init?.body });
      return { data: {} };
    },
  } as unknown as CoreClient;
}

test("only the settings that differ are written, and each is reported", async () => {
  const calls: Call[] = [];
  const client = fakePullZoneClient(calls, {
    DisableCookies: true,
    EnableSmartCache: true,
    CacheControlMaxAgeOverride: 2592000,
  });

  const changed = await applyPullZoneSettings(client, 30, {
    disableCookies: false,
    enableSmartCache: false,
  });

  expect(changed).toEqual([
    "cookies on",
    "Smart Cache off",
    "cache override off",
  ]);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  expect(calls.at(-1)?.body).toEqual({
    DisableCookies: false,
    EnableSmartCache: false,
    CacheControlMaxAgeOverride: -1,
  });
});

test("a pull zone already configured is left alone", async () => {
  const calls: Call[] = [];
  const client = fakePullZoneClient(calls, {
    DisableCookies: false,
    EnableSmartCache: false,
    CacheControlMaxAgeOverride: -1,
  });

  const changed = await applyPullZoneSettings(client, 30, {
    disableCookies: false,
    enableSmartCache: false,
  });

  expect(changed).toEqual([]);
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

// The zone's own override would replace every Cache-Control the adapter sets, so
// turning it off is this command's business rather than the manifest's.
test("the cache override goes off even when the build asks for nothing", async () => {
  const calls: Call[] = [];
  const client = fakePullZoneClient(calls, {
    DisableCookies: true,
    CacheControlMaxAgeOverride: 2592000,
  });

  expect(await applyPullZoneSettings(client, 30, undefined)).toEqual([
    "cache override off",
  ]);
  expect(calls.at(-1)?.body).toEqual({ CacheControlMaxAgeOverride: -1 });
});

function fakeScriptClient(
  calls: Call[],
  existing: {
    variables?: { Name: string; DefaultValue: string }[];
    secrets?: { Name: string }[];
  },
): ComputeClient {
  return {
    GET: async (path: string) => {
      calls.push({ method: "GET", path });
      if (path === "/compute/script/{id}/secrets") {
        return { data: { Secrets: existing.secrets ?? [] } };
      }
      return { data: { EdgeScriptVariables: existing.variables ?? [] } };
    },
    PUT: async (path: string, init?: { body?: unknown }) => {
      calls.push({ method: "PUT", path, body: init?.body });
      return { data: {} };
    },
  } as unknown as ComputeClient;
}

test("a variable already holding the right value is not written again", async () => {
  const calls: Call[] = [];
  const client = fakeScriptClient(calls, {
    variables: [{ Name: "BUNNY_STORAGE_ZONE", DefaultValue: "my-site" }],
  });

  const set = await applyScriptEnv(client, 20, [
    { name: "BUNNY_STORAGE_ZONE", value: "my-site" },
    { name: "BUNNY_PULLZONE_ID", value: "30" },
  ]);

  expect(set).toEqual(["BUNNY_PULLZONE_ID"]);
  const writes = calls.filter((c) => c.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toEqual({
    Name: "BUNNY_PULLZONE_ID",
    DefaultValue: "30",
  });
});

// A secret cannot be read back, so a rotated password must survive a deploy.
test("an existing secret is left in place", async () => {
  const calls: Call[] = [];
  const client = fakeScriptClient(calls, {
    secrets: [{ Name: "BUNNY_STORAGE_KEY" }],
  });

  const set = await applyScriptEnv(client, 20, [
    { name: "BUNNY_STORAGE_KEY", value: "a-new-password", secret: true },
  ]);

  expect(set).toEqual([]);
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
});

test("a secret that is not there yet is written once", async () => {
  const calls: Call[] = [];
  const client = fakeScriptClient(calls, {});

  const set = await applyScriptEnv(client, 20, [
    { name: "bunny_storage_key", value: "password", secret: true },
  ]);

  expect(set).toEqual(["BUNNY_STORAGE_KEY"]);
  expect(calls.at(-1)).toEqual({
    method: "PUT",
    path: "/compute/script/{id}/secrets",
    body: { Name: "BUNNY_STORAGE_KEY", Secret: "password" },
  });
});

const ZONE = {
  Id: 10,
  Name: "sites-my-site-k3f9wq",
  Region: "NY",
  Password: "write-password",
  ReadOnlyPassword: "read-password",
} as StorageZoneModel;

function manifest(requires?: BuildManifest["requires"]): BuildManifest {
  return {
    manifestVersion: 1,
    adapter: { package: "@bunny.net/astro-adapter" },
    framework: { name: "astro" },
    kind: "ssr",
    script: { entry: "dist/index.js", type: "standalone" },
    assets: { dir: "dist/client" },
    requires,
  };
}

test("the script gets the read-only password for assets, and no typing", () => {
  const { entries } = resolveScriptEnv(
    manifest({
      env: [
        { name: "BUNNY_STORAGE_ZONE" },
        { name: "BUNNY_STORAGE_HOST" },
        { name: "BUNNY_STORAGE_KEY", secret: true },
      ],
    }),
    ZONE,
    30,
  );

  expect(entries).toEqual([
    { name: "BUNNY_STORAGE_ZONE", value: "sites-my-site-k3f9wq" },
    { name: "BUNNY_STORAGE_HOST", value: "ny.storage.bunnycdn.com" },
    { name: "BUNNY_STORAGE_KEY", value: "read-password", secret: true },
  ]);
});

// Sessions have to write, and only sessions do.
test("sessions get the password that can write, and only when asked for", () => {
  const withSessions = resolveScriptEnv(
    manifest({
      storage: { write: true },
      env: [{ name: "BUNNY_SESSION_ZONE" }, { name: "BUNNY_SESSION_KEY" }],
    }),
    ZONE,
    30,
  );
  expect(withSessions.entries).toEqual([
    { name: "BUNNY_SESSION_ZONE", value: "sites-my-site-k3f9wq" },
    { name: "BUNNY_SESSION_KEY", value: "write-password", secret: true },
  ]);

  const without = resolveScriptEnv(
    manifest({ env: [{ name: "BUNNY_SESSION_ZONE" }] }),
    ZONE,
    30,
  );
  expect(without.entries).toEqual([]);
  expect(without.unset).toEqual(["BUNNY_SESSION_ZONE"]);
});

test("a variable the CLI cannot supply is reported, not invented", () => {
  const { entries, unset } = resolveScriptEnv(
    manifest({
      env: [
        { name: "BUNNY_PULLZONE_ID" },
        { name: "BUNNY_API_KEY", secret: true, optional: true },
      ],
    }),
    ZONE,
    30,
  );
  expect(entries).toEqual([{ name: "BUNNY_PULLZONE_ID", value: "30" }]);
  expect(unset).toEqual(["BUNNY_API_KEY"]);
});
