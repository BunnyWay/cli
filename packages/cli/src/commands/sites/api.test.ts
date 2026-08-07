import { afterAll, beforeEach, expect, test } from "bun:test";
import { ApiError } from "../../core/errors.ts";
import type { CoreClient, StorageZoneModel } from "../storage/api.ts";
import {
  type ComputeClient,
  createSite,
  deleteSiteResources,
  ensurePreviewZone,
  ensureRouterCurrent,
  fetchSites,
  findPreviewZones,
  promoteDeploy,
  promoteVerification,
  readRemoteState,
  siteContextFromZone,
  siteFiles,
  writeRemoteState,
} from "./api.ts";
import {
  REMOTE_STATE_PATH,
  type RemoteSiteState,
  STATE_VERSION,
} from "./constants.ts";
import { ROUTER_VERSION } from "./router/source.ts";

// ---- in-memory storage-file store (replaces the storage SDK) ----

const store = new Map<string, string>();
const original = { ...siteFiles };
const originalVerification = { ...promoteVerification };

beforeEach(() => {
  store.clear();
  // Promote probes the CDN and sleeps between attempts; keep tests offline and fast.
  promoteVerification.wait = async () => {};
  promoteVerification.probe = async () => 200;
  siteFiles.connect = (zone) =>
    ({ zoneName: zone.Name }) as unknown as ReturnType<
      typeof siteFiles.connect
    >;
  siteFiles.download = async (_zone, path) => {
    const content = store.get(path);
    if (content === undefined) throw new Error("404 Not Found");
    // Bun's Blob stream is web-standard; cast to the SDK's exact download return type.
    return {
      stream: new Blob([content]).stream(),
      response: new Response(content),
      length: content.length,
    } as Awaited<ReturnType<typeof siteFiles.download>>;
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
  Object.assign(promoteVerification, originalVerification);
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
  /** Throw this from POST /storagezone or POST /pullzone (a taken name); `times` bounds how often (default: always). */
  createError?: {
    path: "/storagezone" | "/pullzone";
    error: ApiError;
    times?: number;
  };
}): CoreClient {
  const zones = opts.storageZones ?? [];
  const pullZones = opts.pullZones ?? [];
  let nextPullZoneId = 30;
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
      if (path === "/pullzone/{id}") {
        const pz = pullZones.find((p) => p.Id === options?.params?.path?.id);
        return {
          data: pz ?? {
            Id: options?.params?.path?.id,
            Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
          },
        };
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
      if (opts.createError && path === opts.createError.path) {
        if (
          opts.createError.times === undefined ||
          opts.createError.times > 0
        ) {
          if (opts.createError.times !== undefined) opts.createError.times--;
          throw opts.createError.error;
        }
      }
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
        const name = (options?.body as { Name: string }).Name;
        const pz = {
          Id: nextPullZoneId++,
          Name: name,
          Hostnames: [{ IsSystemHostname: true, Value: `${name}.b-cdn.net` }],
        };
        pullZones.push(pz);
        return { data: pz };
      }
      if (path === "/pullzone/{id}") return { data: {} };
      if (path === "/pullzone/{id}/setForceSSL") return { data: undefined };
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
  let nextScriptId = 20;
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
          Id: nextScriptId++,
          Name: (options?.body as { Name: string }).Name,
        };
        scripts.push(script);
        return { data: script };
      }
      return { data: {} };
    },
    PUT: async (
      path: string,
      options?: { params?: unknown; body?: unknown },
    ) => {
      opts.calls.push({
        method: "PUT",
        path,
        params: options?.params as Record<string, unknown>,
        body: options?.body,
      });
      return { data: {} };
    },
    DELETE: async (path: string, options?: { params?: unknown }) => {
      opts.calls.push({
        method: "DELETE",
        path,
        params: options?.params as Record<string, unknown>,
      });
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

test("readRemoteState rethrows transient read errors (no fail-open)", async () => {
  const connection = fakeConnection();
  siteFiles.download = async () => {
    throw new Error("Timeout connecting to storage");
  };
  await expect(readRemoteState(connection)).rejects.toThrow("Timeout");
});

test("writeRemoteState refuses to overwrite an unparseable conflict", async () => {
  const connection = fakeConnection();
  const etag = await writeRemoteState(connection, fakeState());

  // A concurrent writer left the state unparseable between our read and write.
  store.set(REMOTE_STATE_PATH, "garbage");
  await expect(
    writeRemoteState(connection, fakeState({ current: "aaa" }), etag),
  ).rejects.toThrow("no longer parseable");
});

test("writeRemoteState merges concurrent deploy records on an etag mismatch", async () => {
  const connection = fakeConnection();
  const etag = await writeRemoteState(connection, fakeState());

  // Simulate a concurrent deploy landing between our read and write.
  const theirs = {
    id: "zzz",
    createdAt: "2026-01-02T00:00:00.000Z",
    source: "git" as const,
    contentHash: "hashzzz",
    files: 1,
    bytes: 10,
  };
  store.set(
    REMOTE_STATE_PATH,
    JSON.stringify(fakeState({ current: "zzz", deploys: [theirs] })),
  );

  const ours = {
    id: "aaa",
    createdAt: "2026-01-03T00:00:00.000Z",
    source: "git" as const,
    contentHash: "hashaaa",
    files: 1,
    bytes: 10,
  };
  await writeRemoteState(
    connection,
    fakeState({ current: "aaa", deploys: [ours] }),
    etag,
    { promotedTo: "aaa" },
  );
  const read = await readRemoteState(connection);
  // Our promote wins, their deploy record survives, and their promote becomes the rollback target.
  expect(read?.state.current).toBe("aaa");
  expect(read?.state.previous).toBe("zzz");
  expect(read?.state.deploys.map((d) => d.id)).toEqual(["aaa", "zzz"]);
});

test("a non-promoting write adopts the concurrent writer's current/previous", async () => {
  const connection = fakeConnection();
  const etag = await writeRemoteState(connection, fakeState());

  // A concurrent promote lands between our read and write.
  const theirs = {
    id: "zzz",
    createdAt: "2026-01-02T00:00:00.000Z",
    source: "git" as const,
    contentHash: "hashzzz",
    files: 1,
    bytes: 10,
  };
  store.set(
    REMOTE_STATE_PATH,
    JSON.stringify(
      fakeState({ current: "zzz", previous: "yyy", deploys: [theirs] }),
    ),
  );

  const ours = {
    id: "aaa",
    createdAt: "2026-01-03T00:00:00.000Z",
    source: "git" as const,
    contentHash: "hashaaa",
    files: 1,
    bytes: 10,
  };
  // A preview-only deploy: its stale in-memory pointers must not reverse the promote.
  await writeRemoteState(connection, fakeState({ deploys: [ours] }), etag);
  const read = await readRemoteState(connection);
  expect(read?.state.current).toBe("zzz");
  expect(read?.state.previous).toBe("yyy");
  expect(read?.state.deploys.map((d) => d.id)).toEqual(["aaa", "zzz"]);
});

test("writeRemoteState does not resurrect intentionally removed deploys on a prune/deploy race", async () => {
  const connection = fakeConnection();
  const kept = {
    id: "keep",
    createdAt: "2026-01-03T00:00:00.000Z",
    source: "content" as const,
    contentHash: "hashkeep",
    files: 1,
    bytes: 10,
  };
  const victim = { ...kept, id: "old", createdAt: "2026-01-01T00:00:00.000Z" };
  const etag = await writeRemoteState(
    connection,
    fakeState({ deploys: [kept, victim] }),
  );

  // A racing deploy re-writes the pre-prune state (still holding the victim) and adds its own record.
  const fresh = { ...kept, id: "new", createdAt: "2026-01-04T00:00:00.000Z" };
  store.set(
    REMOTE_STATE_PATH,
    JSON.stringify(fakeState({ deploys: [fresh, kept, victim] })),
  );

  // Prune deleted `old`'s files and dropped it from state; it reports the removal.
  await writeRemoteState(connection, fakeState({ deploys: [kept] }), etag, {
    removedIds: ["old"],
  });

  const read = await readRemoteState(connection);
  // The racing deploy's record survives; the pruned one is not restored to point at deleted files.
  expect(read?.state.deploys.map((d) => d.id).sort()).toEqual(["keep", "new"]);
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

  // Zone names are globally unique, so both carry a shared random suffix.
  const zoneCreate = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/storagezone",
  );
  const zoneName = (zoneCreate?.body as { Name: string }).Name;
  expect(zoneName).toMatch(/^sites-my-site-[a-z0-9]{6}$/);
  expect(result.systemHostname).toBe(`${zoneName}.b-cdn.net`);

  // The router script is uploaded, published, and gets CURRENT_DEPLOY="".
  const computePaths = computeCalls.map((c) => `${c.method} ${c.path}`);
  expect(computePaths).toContain("POST /compute/script");
  expect(computePaths).toContain("POST /compute/script/{id}/code");
  expect(computePaths).toContain("POST /compute/script/{id}/publish");
  const scriptCreate = computeCalls.find(
    (c) => c.path === "/compute/script" && c.method === "POST",
  );
  expect(scriptCreate?.body).toMatchObject({ Name: `${zoneName}-router` });
  const envSet = computeCalls.find(
    (c) => c.path === "/compute/script/{id}/variables",
  );
  expect(envSet?.body).toEqual({ Name: "CURRENT_DEPLOY", DefaultValue: "" });

  // Exactly one pull zone (production) is created; the router is attached.
  const pzCreates = coreCalls.filter(
    (c) => c.method === "POST" && c.path === "/pullzone",
  );
  expect(pzCreates).toHaveLength(1);
  expect(pzCreates[0]?.body).toMatchObject({
    Name: zoneName,
    StorageZoneId: 10,
  });
  const attach = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/pullzone/{id}",
  );
  expect(attach?.body).toEqual({ MiddlewareScriptId: 20 });

  // The system host redirects HTTP → HTTPS out of the box.
  const forceSsl = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/pullzone/{id}/setForceSSL",
  );
  expect(forceSsl?.body).toEqual({
    Hostname: `${zoneName}.b-cdn.net`,
    ForceSSL: true,
  });

  // Exactly one middleware script (the router) is created.
  expect(computePaths.filter((p) => p === "POST /compute/script")).toHaveLength(
    1,
  );

  // Remote state marks the zone as a site.
  const written = await readRemoteState(fakeConnection());
  expect(written?.state).toMatchObject({
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
    scriptId: 20,
  });
});

test("createSite re-run reuses existing resources and converges", async () => {
  const coreCalls: Call[] = [];
  const computeCalls: Call[] = [];
  // Everything already exists; but no remote state (a half-finished create).
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    storageZones: [{ ...ZONE, Name: "sites-my-site-abc123" }],
    pullZones: [
      {
        Id: 30,
        Name: "sites-my-site-abc123",
        StorageZoneId: 10,
        Hostnames: [],
      },
    ],
  });
  const computeClient = fakeComputeClient({
    calls: computeCalls,
    scripts: [{ Id: 20, Name: "sites-my-site-abc123-router" }],
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

test("createSite resumes a half-created suffixed site", async () => {
  const coreCalls: Call[] = [];
  const computeCalls: Call[] = [];
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123" };
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    storageZones: [suffixed],
    pullZones: [
      {
        Id: 30,
        Name: "sites-my-site-abc123",
        StorageZoneId: 10,
        Hostnames: [],
      },
    ],
  });
  const computeClient = fakeComputeClient({
    calls: computeCalls,
    scripts: [{ Id: 20, Name: "sites-my-site-abc123-router" }],
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
  // The site keeps its clean display name; only the zones carry the suffix.
  expect(result.state.name).toBe("my-site");
});

test("createSite refuses to re-provision an existing suffixed site", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123" };
  const coreClient = fakeCoreClient({ calls: [], storageZones: [suffixed] });
  const computeClient = fakeComputeClient({ calls: [] });

  await expect(
    createSite({ coreClient, computeClient, name: "my-site", region: "DE" }),
  ).rejects.toThrow('Site "my-site" already exists.');
});

test("createSite gives up after every storage zone suffix collides", async () => {
  // Every suffixed candidate comes back 409 (in practice: the API rejecting the
  // name for another reason the taken-name check matches).
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    createError: {
      path: "/storagezone",
      error: new ApiError(
        "Conflict. The resource already exists or is in use.",
        409,
      ),
    },
  });
  const computeClient = fakeComputeClient({ calls: [] });

  await expect(
    createSite({ coreClient, computeClient, name: "my-site", region: "DE" }),
  ).rejects.toThrow(
    'Couldn\'t find an available storage zone name for "my-site".',
  );
  // Each attempt used a fresh suffixed candidate.
  const attempts = coreCalls
    .filter((c) => c.method === "POST" && c.path === "/storagezone")
    .map((c) => (c.body as { Name: string }).Name);
  expect(attempts).toHaveLength(3);
  for (const name of attempts)
    expect(name).toMatch(/^sites-my-site-[a-z0-9]{6}$/);
});

test("createSite retries the pull zone with a fresh suffix when the name is taken", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    createError: {
      path: "/pullzone",
      error: new ApiError("The name is already taken.", 400),
      times: 1,
    },
  });
  const computeClient = fakeComputeClient({ calls: [] });

  const result = await createSite({
    coreClient,
    computeClient,
    name: "my-site",
    region: "DE",
  });

  const attempts = coreCalls
    .filter((c) => c.method === "POST" && c.path === "/pullzone")
    .map((c) => (c.body as { Name: string }).Name);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toMatch(/^sites-my-site-[a-z0-9]{6}$/);
  expect(result.reused.pullZone).toBe(false);
});

test("createSite gives up after every pull zone suffix collides", async () => {
  const coreClient = fakeCoreClient({
    calls: [],
    createError: {
      path: "/pullzone",
      error: new ApiError("The name is already taken.", 400),
    },
  });
  const computeClient = fakeComputeClient({ calls: [] });

  await expect(
    createSite({ coreClient, computeClient, name: "my-site", region: "DE" }),
  ).rejects.toThrow(
    'Couldn\'t find an available pull zone name for "my-site".',
  );
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
  // Purged twice: once immediately, once after the edge picks up the new deploy.
  const purges = coreCalls.filter(
    (c) => c.path === "/pullzone/{id}/purgeCache",
  );
  expect(purges).toHaveLength(2);
  expect(purges[0]?.params).toEqual({ path: { id: 30 } });
});

test("promoteDeploy waits for the edge to serve a deploy before the final purge", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });
  const computeClient = fakeComputeClient({ calls: [] });

  // The edge returns the 404 placeholder until CURRENT_DEPLOY propagates.
  const statuses = [404, 404, 200];
  const probed: string[] = [];
  promoteVerification.probe = async (url) => {
    probed.push(url);
    return statuses.shift() ?? 200;
  };

  await promoteDeploy({
    computeClient,
    coreClient,
    state: fakeState(),
    deployId: "a1b2c3d4",
  });

  // Kept probing past the placeholder, then purged a second time.
  expect(probed.length).toBe(3);
  expect(probed[0]).toContain("my-site.b-cdn.net");
  expect(
    coreCalls.filter((c) => c.path === "/pullzone/{id}/purgeCache"),
  ).toHaveLength(2);
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
      // Plain storage pull zone; no middleware, never fetched.
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

// Preview zones share the middleware+storage shape with real sites; the name pattern must skip them before any per-zone state read happens.
test("fetchSites skips preview zones without reading their state", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const calls: Call[] = [];
  const coreClient = fakeCoreClient({
    calls,
    storageZones: [ZONE],
    pullZones: [
      {
        Id: 30,
        Name: "my-site",
        MiddlewareScriptId: 20,
        StorageZoneId: 10,
        Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
      },
      {
        Id: 77,
        Name: "sites-dpl-a1b2c3d4-abc123",
        MiddlewareScriptId: 20,
        StorageZoneId: 10,
      },
    ],
  });

  const sites = await fetchSites(coreClient);
  expect(sites).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/storagezone/{id}")).toHaveLength(1);
});

// ---- preview zones ----

test("ensurePreviewZone creates the zone, attaches the router, and returns its host", async () => {
  const calls: Call[] = [];
  const coreClient = fakeCoreClient({ calls });

  const zone = await ensurePreviewZone({
    coreClient,
    state: fakeState(),
    deployId: "a1b2c3d4",
  });

  expect(zone?.host).toMatch(/^sites-dpl-a1b2c3d4-[a-z0-9]{6}\.b-cdn\.net$/);
  const create = calls.find(
    (c) => c.method === "POST" && c.path === "/pullzone",
  );
  expect((create?.body as { StorageZoneId: number }).StorageZoneId).toBe(10);
  const attach = calls.find(
    (c) => c.method === "POST" && c.path === "/pullzone/{id}",
  );
  expect(attach?.body).toEqual({ MiddlewareScriptId: 20 });
});

// A zone created before a failed state write must be adopted on retry, not duplicated.
test("ensurePreviewZone adopts an existing zone for the deploy", async () => {
  const calls: Call[] = [];
  const coreClient = fakeCoreClient({
    calls,
    pullZones: [
      // Same name shape but another site's storage zone: never adopted.
      {
        Id: 76,
        Name: "sites-dpl-a1b2c3d4-zzzzzz",
        StorageZoneId: 99,
        Hostnames: [
          {
            IsSystemHostname: true,
            Value: "sites-dpl-a1b2c3d4-zzzzzz.b-cdn.net",
          },
        ],
      },
      {
        Id: 77,
        Name: "sites-dpl-a1b2c3d4-abc123",
        StorageZoneId: 10,
        Hostnames: [
          {
            IsSystemHostname: true,
            Value: "sites-dpl-a1b2c3d4-abc123.b-cdn.net",
          },
        ],
      },
    ],
  });

  const zone = await ensurePreviewZone({
    coreClient,
    state: fakeState(),
    deployId: "a1b2c3d4",
  });

  expect(zone).toEqual({ id: 77, host: "sites-dpl-a1b2c3d4-abc123.b-cdn.net" });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

// A preview failure must not fail the deploy; the caller warns and the next run retries.
test("ensurePreviewZone returns null when creation fails", async () => {
  const coreClient = fakeCoreClient({
    calls: [],
    createError: {
      path: "/pullzone",
      error: new ApiError("boom", 500, "boom"),
    },
  });

  expect(
    await ensurePreviewZone({
      coreClient,
      state: fakeState(),
      deployId: "a1b2c3d4",
    }),
  ).toBeNull();
});

test("findPreviewZones matches by name shape and the site's storage zone", async () => {
  const coreClient = fakeCoreClient({
    calls: [],
    pullZones: [
      { Id: 30, Name: "my-site", StorageZoneId: 10 },
      { Id: 77, Name: "sites-dpl-a1b2c3d4-abc123", StorageZoneId: 10 },
      { Id: 78, Name: "sites-dpl-ffff0000-abc123", StorageZoneId: 10 },
      { Id: 79, Name: "sites-dpl-a1b2c3d4-zzzzzz", StorageZoneId: 99 },
    ],
  });

  expect(await findPreviewZones(coreClient, 10)).toEqual([
    { id: 77, deployId: "a1b2c3d4" },
    { id: 78, deployId: "ffff0000" },
  ]);
});

// ---- router upgrades ----

test("ensureRouterCurrent republishes an outdated router and stamps the version", async () => {
  const calls: Call[] = [];
  const computeClient = fakeComputeClient({ calls });
  const state = fakeState();

  expect(await ensureRouterCurrent({ computeClient, state })).toBe(true);
  expect(state.routerVersion).toBe(ROUTER_VERSION);
  expect(calls.map((c) => c.path)).toEqual([
    "/compute/script/{id}/code",
    "/compute/script/{id}/publish",
  ]);

  // Already current: no calls at all.
  const noCalls: Call[] = [];
  expect(
    await ensureRouterCurrent({
      computeClient: fakeComputeClient({ calls: noCalls }),
      state,
    }),
  ).toBe(false);
  expect(noCalls).toHaveLength(0);
});

test("siteContextFromZone is null for a zone without site state", async () => {
  expect(await siteContextFromZone(ZONE)).toBeNull();
});

// ---- teardown ----

test("deleteSiteResources removes the site marker when keeping storage", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  store.set("deploys/aaa/index.html", "<h1>hi</h1>");
  const coreClient = fakeCoreClient({ calls: [] });
  const computeClient = fakeComputeClient({ calls: [] });

  const results = await deleteSiteResources({
    coreClient,
    computeClient,
    state: fakeState(),
    keepStorage: true,
    connection: fakeConnection(),
  });

  // The storage zone was never deleted…
  expect(results.some((r) => r.resource === "storage zone")).toBe(false);
  // …but its site marker is gone, so list/link/show can't rediscover it.
  expect(store.has(REMOTE_STATE_PATH)).toBe(false);
  // Deploy files are untouched.
  expect(store.has("deploys/aaa/index.html")).toBe(true);
});

test("deleteSiteResources deletes the pull zone, router, and storage zone", async () => {
  const coreCalls: Call[] = [];
  const computeCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });
  const computeClient = fakeComputeClient({ calls: computeCalls });

  const results = await deleteSiteResources({
    coreClient,
    computeClient,
    state: fakeState(),
  });

  const deletedPullZoneIds = coreCalls
    .filter((c) => c.method === "DELETE" && c.path === "/pullzone/{id}")
    .map((c) => (c.params as { path: { id: number } }).path.id);
  expect(deletedPullZoneIds).toEqual([30]);
  const deletedScriptIds = computeCalls
    .filter((c) => c.method === "DELETE" && c.path === "/compute/script/{id}")
    .map((c) => (c.params as { path: { id: number } }).path.id);
  expect(deletedScriptIds).toEqual([20]);
  // Pull zone + router script + storage zone.
  expect(results.filter((r) => r.deleted)).toHaveLength(3);
});

// Regression: the live API returns GET /pullzone as a paginated envelope
// ({ Items, CurrentPage, HasMoreItems }); the spec's plain array is a lie
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

// Preview zones reference the script and storage zone, so teardown must take them down too: the recorded ids plus a name-shape sweep for orphans.
test("deleteSiteResources deletes preview zones before the site's own resources", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    pullZones: [
      // Orphan: preview-shaped, this site's storage zone, missing from state.
      { Id: 78, Name: "sites-dpl-ffff0000-abc123", StorageZoneId: 10 },
    ],
  });
  const computeClient = fakeComputeClient({ calls: [] });

  const state = fakeState({
    deploys: [
      {
        id: "a1b2c3d4",
        createdAt: "2026-01-01T00:00:00Z",
        source: "git",
        contentHash: "hash1",
        files: 1,
        bytes: 1,
        previewZoneId: 77,
        previewHost: "sites-dpl-a1b2c3d4-abc123.b-cdn.net",
      },
    ],
  });
  const results = await deleteSiteResources({
    coreClient,
    computeClient,
    state,
  });

  const deletedPullZoneIds = coreCalls
    .filter((c) => c.method === "DELETE" && c.path === "/pullzone/{id}")
    .map((c) => (c.params as { path: { id: number } }).path.id);
  expect(deletedPullZoneIds).toEqual([77, 78, 30]);
  expect(
    results.filter((r) => r.resource === "preview zone" && r.deleted),
  ).toHaveLength(2);
});
