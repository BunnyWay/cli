import { afterAll, beforeEach, expect, test } from "bun:test";
import type { CoreClient, StorageZoneModel } from "../storage/api.ts";
import {
  type ComputeClient,
  createSite,
  fetchSites,
  promoteDeploy,
  readRemoteEnv,
  readRemoteState,
  siteContextFromZone,
  siteFiles,
  writeRemoteState,
} from "./api.ts";
import {
  REMOTE_ENV_PATH,
  REMOTE_STATE_PATH,
  type RemoteSiteState,
  STATE_VERSION,
} from "./constants.ts";
import { ROUTER_VERSION } from "./router/source.ts";

// ---- in-memory storage-file store (replaces the storage SDK) ----

const store = new Map<string, string>();
const original = { ...siteFiles };

beforeEach(() => {
  store.clear();
  siteFiles.connect = (zone) =>
    ({ zoneName: zone.Name }) as unknown as ReturnType<
      typeof siteFiles.connect
    >;
  siteFiles.download = async (_zone, path) => {
    const content = store.get(path);
    if (content === undefined) throw new Error("404 Not Found");
    return {
      stream: new Blob([content]).stream(),
      response: new Response(content),
      length: content.length,
    };
  };
  siteFiles.upload = async (_zone, path, stream) => {
    store.set(path, await new Response(stream).text());
  };
  siteFiles.remove = async (_zone, path) => {
    for (const key of [...store.keys()]) {
      if (key.startsWith(path)) store.delete(key);
    }
  };
});

afterAll(() => {
  Object.assign(siteFiles, original);
});

// ---- fake clients: object literals branching on the path string ----

interface Call {
  method: string;
  path: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

const ZONE: StorageZoneModel = {
  Id: 10,
  Name: "my-site",
  Region: "DE",
  Password: "pw",
} as StorageZoneModel;

function fakeConnection() {
  return siteFiles.connect(ZONE);
}

function fakeState(overrides?: Partial<RemoteSiteState>): RemoteSiteState {
  return {
    version: STATE_VERSION,
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
    scriptId: 20,
    routerVersion: ROUTER_VERSION,
    deploys: [],
    ...overrides,
  };
}

function fakeCoreClient(opts: {
  calls: Call[];
  storageZones?: StorageZoneModel[];
  pullZones?: Array<Record<string, unknown>>;
  /**
   * Return GET /pullzone as the live API's paginated envelope
   * (`{ Items, CurrentPage, HasMoreItems }`) instead of the plain array
   * the spec documents. `pageSize` splits the items across pages.
   */
  pullZoneEnvelope?: boolean;
  pageSize?: number;
}): CoreClient {
  const zones = opts.storageZones ?? [];
  const pullZones = opts.pullZones ?? [];
  return {
    GET: async (
      path: string,
      options?: {
        params?: { path?: { id?: number }; query?: { page?: number } };
      },
    ) => {
      opts.calls.push({ method: "GET", path, params: options?.params });
      if (path === "/storagezone") return { data: zones };
      if (path === "/storagezone/{id}") {
        const zone = zones.find((z) => z.Id === options?.params?.path?.id);
        return { data: zone };
      }
      if (path === "/pullzone") {
        if (!opts.pullZoneEnvelope) return { data: pullZones };
        const pageSize = opts.pageSize ?? Math.max(pullZones.length, 1);
        const page = options?.params?.query?.page ?? 0;
        const start = page * pageSize;
        return {
          data: {
            Items: pullZones.slice(start, start + pageSize),
            CurrentPage: page,
            TotalItems: pullZones.length,
            HasMoreItems: start + pageSize < pullZones.length,
          },
        };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    POST: async (
      path: string,
      options?: { params?: unknown; body?: unknown },
    ) => {
      opts.calls.push({
        method: "POST",
        path,
        params: options?.params as Record<string, unknown>,
        body: options?.body,
      });
      if (path === "/storagezone") {
        const zone = {
          ...ZONE,
          Id: 10,
          Name: (options?.body as { Name: string }).Name,
        };
        zones.push(zone);
        return { data: zone };
      }
      if (path === "/pullzone") {
        const pz = {
          Id: 30,
          Name: (options?.body as { Name: string }).Name,
          Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
        };
        pullZones.push(pz);
        return { data: pz };
      }
      if (path === "/pullzone/{id}") return { data: {} };
      if (path === "/pullzone/{id}/purgeCache") return { data: undefined };
      throw new Error(`unexpected POST ${path}`);
    },
    DELETE: async (path: string, options?: { params?: unknown }) => {
      opts.calls.push({
        method: "DELETE",
        path,
        params: options?.params as Record<string, unknown>,
      });
      return { data: undefined };
    },
  } as unknown as CoreClient;
}

function fakeComputeClient(opts: {
  calls: Call[];
  scripts?: Array<{ Id: number; Name: string }>;
}): ComputeClient {
  const scripts = opts.scripts ?? [];
  return {
    GET: async (path: string) => {
      opts.calls.push({ method: "GET", path });
      if (path === "/compute/script") return { data: { Items: scripts } };
      throw new Error(`unexpected GET ${path}`);
    },
    POST: async (path: string, options?: { body?: unknown }) => {
      opts.calls.push({ method: "POST", path, body: options?.body });
      if (path === "/compute/script") {
        const script = {
          Id: 20,
          Name: (options?.body as { Name: string }).Name,
        };
        scripts.push(script);
        return { data: script };
      }
      return { data: {} };
    },
    PUT: async (path: string, options?: { body?: unknown }) => {
      opts.calls.push({ method: "PUT", path, body: options?.body });
      return { data: {} };
    },
    DELETE: async (path: string) => {
      opts.calls.push({ method: "DELETE", path });
      return { data: undefined };
    },
  } as unknown as ComputeClient;
}

// ---- remote state round-trip ----

test("writeRemoteState/readRemoteState round-trip with a stable etag", async () => {
  const connection = fakeConnection();
  const state = fakeState();

  const etag = await writeRemoteState(connection, state);
  const read = await readRemoteState(connection);

  expect(read?.state).toEqual(state);
  expect(read?.etag).toBe(etag);
});

test("readRemoteState is null for missing or invalid state", async () => {
  const connection = fakeConnection();
  expect(await readRemoteState(connection)).toBeNull();

  store.set(REMOTE_STATE_PATH, "not json");
  expect(await readRemoteState(connection)).toBeNull();
});

test("writeRemoteState overwrites (with a warning) on an etag mismatch", async () => {
  const connection = fakeConnection();
  const etag = await writeRemoteState(connection, fakeState());

  // Simulate a concurrent deploy changing the remote state.
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState({ current: "zzz" })));

  await writeRemoteState(connection, fakeState({ current: "aaa" }), etag);
  const read = await readRemoteState(connection);
  expect(read?.state.current).toBe("aaa");
});

test("readRemoteEnv tolerates missing and malformed files", async () => {
  const connection = fakeConnection();
  expect(await readRemoteEnv(connection)).toEqual({});

  store.set(REMOTE_ENV_PATH, "{broken");
  expect(await readRemoteEnv(connection)).toEqual({});

  store.set(REMOTE_ENV_PATH, JSON.stringify({ A: "1", B: 2, C: "3" }));
  // Non-string values are dropped, not crashed on.
  expect(await readRemoteEnv(connection)).toEqual({ A: "1", C: "3" });
});

// ---- provisioning ----

test("createSite provisions storage zone → router → pull zone → state", async () => {
  const coreCalls: Call[] = [];
  const computeCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });
  const computeClient = fakeComputeClient({ calls: computeCalls });

  const result = await createSite({
    coreClient,
    computeClient,
    name: "my-site",
    region: "DE",
  });

  expect(result.reused).toEqual({
    storageZone: false,
    script: false,
    pullZone: false,
  });
  expect(result.systemHostname).toBe("my-site.b-cdn.net");

  // The router script is uploaded, published, and gets CURRENT_DEPLOY="".
  const computePaths = computeCalls.map((c) => `${c.method} ${c.path}`);
  expect(computePaths).toContain("POST /compute/script");
  expect(computePaths).toContain("POST /compute/script/{id}/code");
  expect(computePaths).toContain("POST /compute/script/{id}/publish");
  const envSet = computeCalls.find(
    (c) => c.path === "/compute/script/{id}/variables",
  );
  expect(envSet?.body).toEqual({ Name: "CURRENT_DEPLOY", DefaultValue: "" });

  // The pull zone is created from the storage zone and the router is attached.
  const pzCreate = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/pullzone",
  );
  expect(pzCreate?.body).toMatchObject({ Name: "my-site", StorageZoneId: 10 });
  const attach = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/pullzone/{id}",
  );
  expect(attach?.body).toEqual({ MiddlewareScriptId: 20 });

  // Remote state marks the zone as a site.
  const written = await readRemoteState(fakeConnection());
  expect(written?.state).toMatchObject({
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
    scriptId: 20,
    routerVersion: ROUTER_VERSION,
  });
});

test("createSite re-run reuses existing resources and converges", async () => {
  const coreCalls: Call[] = [];
  const computeCalls: Call[] = [];
  // Everything already exists — but no remote state (a half-finished create).
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    storageZones: [ZONE],
    pullZones: [{ Id: 30, Name: "my-site", Hostnames: [] }],
  });
  const computeClient = fakeComputeClient({
    calls: computeCalls,
    scripts: [{ Id: 20, Name: "my-site-router" }],
  });

  const result = await createSite({
    coreClient,
    computeClient,
    name: "my-site",
    region: "DE",
  });

  expect(result.reused).toEqual({
    storageZone: true,
    script: true,
    pullZone: true,
  });
  // Nothing new was created…
  expect(
    coreCalls.filter((c) => c.method === "POST" && c.path === "/storagezone"),
  ).toHaveLength(0);
  expect(
    computeCalls.filter(
      (c) => c.method === "POST" && c.path === "/compute/script",
    ),
  ).toHaveLength(0);
  // …but the router republish and attach still ran (idempotent convergence).
  expect(computeCalls.map((c) => c.path)).toContain(
    "/compute/script/{id}/code",
  );
  expect(coreCalls.map((c) => `${c.method} ${c.path}`)).toContain(
    "POST /pullzone/{id}",
  );
  expect(await readRemoteState(fakeConnection())).not.toBeNull();
});

test("createSite refuses to re-provision an existing site", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const coreClient = fakeCoreClient({ calls: [], storageZones: [ZONE] });
  const computeClient = fakeComputeClient({ calls: [] });

  await expect(
    createSite({ coreClient, computeClient, name: "my-site", region: "DE" }),
  ).rejects.toThrow('Site "my-site" already exists.');
});

// ---- promote ----

test("promoteDeploy sets CURRENT_DEPLOY and purges the pull zone cache", async () => {
  const coreCalls: Call[] = [];
  const computeCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });
  const computeClient = fakeComputeClient({ calls: computeCalls });

  await promoteDeploy({
    computeClient,
    coreClient,
    state: fakeState(),
    deployId: "a1b2c3d4",
  });

  const envSet = computeCalls.find((c) => c.method === "PUT");
  expect(envSet?.body).toEqual({
    Name: "CURRENT_DEPLOY",
    DefaultValue: "a1b2c3d4",
  });
  const purge = coreCalls.find((c) => c.path === "/pullzone/{id}/purgeCache");
  expect(purge?.params).toEqual({ path: { id: 30 } });
});

// ---- discovery ----

test("fetchSites keeps only middleware+storage pull zones with matching state", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [ZONE],
    pullZones: [
      // A real site.
      {
        Id: 30,
        Name: "my-site",
        MiddlewareScriptId: 20,
        StorageZoneId: 10,
        Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
      },
      // Plain storage pull zone — no middleware, never fetched.
      { Id: 31, Name: "not-a-site", StorageZoneId: 10 },
      // Middleware pull zone whose state points elsewhere.
      { Id: 32, Name: "other", MiddlewareScriptId: 9, StorageZoneId: 10 },
    ],
  });

  const sites = await fetchSites(coreClient);
  expect(sites).toHaveLength(1);
  expect(sites[0]?.state.name).toBe("my-site");
  expect(sites[0]?.systemHostname).toBe("my-site.b-cdn.net");
});

test("siteContextFromZone is null for a zone without site state", async () => {
  expect(await siteContextFromZone(ZONE)).toBeNull();
});

// Regression: the live API returns GET /pullzone as a paginated envelope
// ({ Items, CurrentPage, HasMoreItems }) — the spec's plain array is a lie
// for some queries (e.g. ?search=). createSite crashed on `.find` here.

test("createSite handles the paginated /pullzone envelope", async () => {
  const coreClient = fakeCoreClient({ calls: [], pullZoneEnvelope: true });
  const computeClient = fakeComputeClient({ calls: [] });

  const result = await createSite({
    coreClient,
    computeClient,
    name: "my-site",
    region: "DE",
  });

  expect(result.state.pullZoneId).toBe(30);
  expect(result.reused.pullZone).toBe(false);
});

test("fetchSites pages through the /pullzone envelope", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [ZONE],
    pullZones: [
      { Id: 31, Name: "not-a-site", StorageZoneId: 10 },
      {
        Id: 30,
        Name: "my-site",
        MiddlewareScriptId: 20,
        StorageZoneId: 10,
        Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
      },
    ],
    pullZoneEnvelope: true,
    pageSize: 1, // force a second page
  });

  const sites = await fetchSites(coreClient);
  expect(sites).toHaveLength(1);
  expect(sites[0]?.state.name).toBe("my-site");
});
