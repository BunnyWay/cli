import { afterAll, beforeEach, expect, test } from "bun:test";
import type { EdgeRule } from "../../core/edge-rules.ts";
import { ApiError } from "../../core/errors.ts";
import type { CoreClient, StorageZoneModel } from "../storage/api.ts";
import {
  type ComputeClient,
  classifySiteZone,
  createSite,
  deleteSiteResources,
  fetchSites,
  migrateSite,
  promoteDeploy,
  promoteVerification,
  readRemoteState,
  sha256Hex,
  siteContextFromZone,
  siteFiles,
  writeRemoteState,
} from "./api.ts";
import {
  GATE_RULE_DESC,
  LEGACY_STATE_VERSION,
  type LegacySiteState,
  PLACEHOLDER_DEPLOY,
  REMOTE_STATE_PATH,
  REWRITE_RULE_DESC,
  type RemoteSiteState,
  STATE_VERSION,
} from "./constants.ts";

// ---- in-memory storage-file store (replaces the storage SDK) ----

const store = new Map<string, string>();
const original = { ...siteFiles };
const originalVerification = { ...promoteVerification };

beforeEach(() => {
  store.clear();
  // Promote probes the CDN and sleeps between attempts; keep tests offline and fast.
  promoteVerification.wait = async () => {};
  promoteVerification.probe = async (url) => ({
    status: 200,
    deploy:
      new URL(url).searchParams.get("__bunny_promote")?.replace(/-\d+$/, "") ??
      null,
  });
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
    deploys: [],
    ...overrides,
  };
}

function fakeLegacyState(
  overrides?: Partial<LegacySiteState>,
): LegacySiteState {
  return {
    version: LEGACY_STATE_VERSION,
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
    scriptId: 77,
    routerVersion: 5,
    deploys: [],
    ...overrides,
  };
}

function seedLegacy(legacy: LegacySiteState): string {
  const raw = JSON.stringify(legacy);
  store.set(REMOTE_STATE_PATH, raw);
  return sha256Hex(raw);
}

function fakeComputeClient(calls: Call[], opts?: { deleteError?: Error }) {
  return {
    DELETE: async (path: string, options?: { params?: unknown }) => {
      calls.push({
        method: "DELETE",
        path,
        params: options?.params as Record<string, unknown>,
      });
      if (opts?.deleteError) throw opts.deleteError;
      return { data: undefined };
    },
  } as unknown as ComputeClient;
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
  const edgeRules = new Map<number, EdgeRule[]>();
  let nextPullZoneId = 30;
  let nextGuid = 1;
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
        const id = options?.params?.path?.id as number;
        const pz = pullZones.find((p) => p.Id === id);
        return {
          data: {
            ...(pz ?? {
              Id: id,
              Hostnames: [
                { IsSystemHostname: true, Value: "my-site.b-cdn.net" },
              ],
            }),
            EdgeRules: edgeRules.get(id) ?? [],
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
        const body = options?.body as { Name: string; StorageZoneId?: number };
        const name = body.Name;
        const pz = {
          Id: nextPullZoneId++,
          Name: name,
          StorageZoneId: body.StorageZoneId,
          Hostnames: [{ IsSystemHostname: true, Value: `${name}.b-cdn.net` }],
        };
        pullZones.push(pz);
        return { data: pz };
      }
      if (path === "/pullzone/{id}") {
        const id = (options?.params as { path: { id: number } }).path.id;
        const pz = pullZones.find((p) => p.Id === id);
        if (pz) {
          const body = { ...(options?.body as Record<string, unknown>) };
          // The live API clears the script link only for the `0` sentinel.
          if (body.MiddlewareScriptId === 0) body.MiddlewareScriptId = null;
          Object.assign(pz, body);
        }
        return { data: {} };
      }
      if (path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate") {
        const id = (options?.params as { path: { pullZoneId: number } }).path
          .pullZoneId;
        const rule = options?.body as EdgeRule;
        const rules = edgeRules.get(id) ?? [];
        const existing = rule.Guid
          ? rules.findIndex((r) => r.Guid === rule.Guid)
          : -1;
        if (existing >= 0) rules[existing] = rule;
        else rules.push({ ...rule, Guid: `guid-${nextGuid++}` });
        edgeRules.set(id, rules);
        return { data: undefined };
      }
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
    {
      promotedTo: "aaa",
    },
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
  // A non-promoting writer: its stale in-memory pointers must not reverse the promote.
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

test("createSite provisions storage zone → pull zone → edge rules → state", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });

  const result = await createSite({
    coreClient,
    name: "my-site",
    region: "DE",
  });

  expect(result.reused).toEqual({ storageZone: false, pullZone: false });

  // Zone names are globally unique, so both carry a shared random suffix.
  const zoneCreate = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/storagezone",
  );
  const zoneName = (zoneCreate?.body as { Name: string }).Name;
  expect(zoneName).toMatch(/^sites-my-site-[a-z0-9]{6}$/);
  expect(result.systemHostname).toBe(`${zoneName}.b-cdn.net`);

  // Exactly one pull zone (production) is created, plus the cache settings update.
  const pzCreates = coreCalls.filter(
    (c) => c.method === "POST" && c.path === "/pullzone",
  );
  expect(pzCreates).toHaveLength(1);
  expect(pzCreates[0]?.body).toMatchObject({
    Name: zoneName,
    StorageZoneId: 10,
  });
  const settings = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/pullzone/{id}",
  );
  expect(settings?.body).toEqual({
    CacheControlMaxAgeOverride: 2592000,
    CacheControlPublicMaxAgeOverride: 0,
  });

  const rules = coreCalls
    .filter((c) => c.path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate")
    .map((c) => c.body as EdgeRule);
  expect(rules).toHaveLength(5);
  const rewrite = rules.find((r) => r.Description === REWRITE_RULE_DESC);
  expect(rewrite).toMatchObject({
    ActionType: 17,
    ActionParameter1: "10",
    ActionParameter2: zoneName,
    ActionParameter3: `/deploys/${PLACEHOLDER_DEPLOY}/`,
  });
  expect(rewrite?.ExtraActions?.some((a) => a.ActionType === 6)).toBe(false);
  const gate = rules.find((r) => r.Description === GATE_RULE_DESC);
  expect(gate?.TriggerMatchingType).toBe(0);
  expect(gate?.Triggers).toHaveLength(1);
  expect(gate?.Triggers?.[0]?.PatternMatches).toEqual(["*/deploys/*"]);

  // The system host redirects HTTP → HTTPS out of the box.
  const forceSsl = coreCalls.find(
    (c) => c.method === "POST" && c.path === "/pullzone/{id}/setForceSSL",
  );
  expect(forceSsl?.body).toEqual({
    Hostname: `${zoneName}.b-cdn.net`,
    ForceSSL: true,
  });

  // Remote state marks the zone as a site.
  const written = await readRemoteState(fakeConnection());
  expect(written?.state).toMatchObject({
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
  });
});

test("createSite re-run after a crash upserts the same native Storage rules", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });

  await createSite({ coreClient, name: "my-site", region: "DE" });
  const originOf = (rules: EdgeRule[]) => {
    const rule = rules.find((r) => r.Description === REWRITE_RULE_DESC);
    return [
      rule?.ActionType,
      rule?.ActionParameter1,
      rule?.ActionParameter2,
      rule?.ActionParameter3,
    ];
  };
  const firstOrigin = originOf(
    coreCalls
      .filter((c) => c.path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate")
      .map((c) => c.body as EdgeRule),
  );

  // Crash before the state write: the resume must upsert the same rules rather
  // than duplicate them or replace the native Storage origin with a URL hop.
  store.clear();
  coreCalls.length = 0;
  await createSite({ coreClient, name: "my-site", region: "DE" });

  const upserts = coreCalls
    .filter((c) => c.path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate")
    .map((c) => c.body as EdgeRule);
  expect(upserts).toHaveLength(5);
  expect(upserts.every((r) => r.Guid)).toBe(true);
  expect(originOf(upserts)).toEqual(firstOrigin);
});

test("createSite re-run reuses existing resources and converges", async () => {
  const coreCalls: Call[] = [];
  // Everything already exists; but no remote state (a half-finished create).
  const coreClient = fakeCoreClient({
    calls: coreCalls,
    storageZones: [{ ...ZONE, Name: "sites-my-site-abc123" }],
    pullZones: [
      {
        Id: 30,
        Name: "sites-my-site-abc123",
        StorageZoneId: 10,
        Hostnames: [
          { IsSystemHostname: true, Value: "sites-my-site-abc123.b-cdn.net" },
        ],
      },
    ],
  });

  const result = await createSite({
    coreClient,
    name: "my-site",
    region: "DE",
  });

  expect(result.reused).toEqual({ storageZone: true, pullZone: true });
  // Nothing new was created…
  expect(
    coreCalls.filter((c) => c.method === "POST" && c.path === "/storagezone"),
  ).toHaveLength(0);
  // …but the settings and rules still converge on the existing zone.
  expect(coreCalls.map((c) => `${c.method} ${c.path}`)).toContain(
    "POST /pullzone/{id}",
  );
  expect(
    coreCalls.filter(
      (c) => c.path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate",
    ),
  ).toHaveLength(5);
  expect(await readRemoteState(fakeConnection())).not.toBeNull();
});

test("createSite resumes a half-created suffixed site", async () => {
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123" };
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [suffixed],
    pullZones: [
      {
        Id: 30,
        Name: "sites-my-site-abc123",
        StorageZoneId: 10,
        Hostnames: [
          { IsSystemHostname: true, Value: "sites-my-site-abc123.b-cdn.net" },
        ],
      },
    ],
  });

  const result = await createSite({
    coreClient,
    name: "my-site",
    region: "DE",
  });

  expect(result.reused).toEqual({ storageZone: true, pullZone: true });
  // The site keeps its clean display name; only the zones carry the suffix.
  expect(result.state.name).toBe("my-site");
});

test("createSite refuses to resume a half-created zone on another tier", async () => {
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123" };
  const coreClient = fakeCoreClient({ calls: [], storageZones: [suffixed] });

  // The zone is HDD, so an --tier ssd resume would silently finish on the wrong tier.
  await expect(
    createSite({ coreClient, name: "my-site", region: "DE", tier: "ssd" }),
  ).rejects.toThrow("but `--tier ssd` was requested");
});

test("createSite refuses to resume a half-created zone in another region", async () => {
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123", Region: "LA" };
  const coreClient = fakeCoreClient({ calls: [], storageZones: [suffixed] });

  // The zone lives in LA, so an explicit --region de resume would silently keep the files there.
  await expect(
    createSite({ coreClient, name: "my-site", region: "DE" }),
  ).rejects.toThrow("but `--region DE` was requested");
});

test("createSite resumes a half-created zone in another region when none was requested", async () => {
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123", Region: "LA" };
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [suffixed],
    pullZones: [
      {
        Id: 30,
        Name: "sites-my-site-abc123",
        StorageZoneId: 10,
        Hostnames: [
          { IsSystemHostname: true, Value: "sites-my-site-abc123.b-cdn.net" },
        ],
      },
    ],
  });

  const result = await createSite({ coreClient, name: "my-site" });

  expect(result.reused.storageZone).toBe(true);
});

test("createSite resumes a half-created zone when the tier matches", async () => {
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123" };
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [suffixed],
    pullZones: [
      {
        Id: 30,
        Name: "sites-my-site-abc123",
        StorageZoneId: 10,
        Hostnames: [
          { IsSystemHostname: true, Value: "sites-my-site-abc123.b-cdn.net" },
        ],
      },
    ],
  });

  const result = await createSite({
    coreClient,
    name: "my-site",
    region: "DE",
    tier: "hdd",
  });

  expect(result.reused.storageZone).toBe(true);
});

test("createSite refuses to re-provision an existing suffixed site", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const suffixed = { ...ZONE, Name: "sites-my-site-abc123" };
  const coreClient = fakeCoreClient({ calls: [], storageZones: [suffixed] });

  await expect(
    createSite({ coreClient, name: "my-site", region: "DE" }),
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
  await expect(
    createSite({ coreClient, name: "my-site", region: "DE" }),
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

  const result = await createSite({
    coreClient,
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
  await expect(
    createSite({ coreClient, name: "my-site", region: "DE" }),
  ).rejects.toThrow(
    'Couldn\'t find an available pull zone name for "my-site".',
  );
});

// ---- promote ----

test("promoteDeploy retargets the rewrite rule, probes the edge, and purges twice", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls, storageZones: [ZONE] });

  // The edge serves the outgoing deploy until the rule propagates.
  const serving = ["old", "old", "a1b2c3d4"];
  const probed: string[] = [];
  promoteVerification.probe = async (url) => {
    probed.push(url);
    return { status: 200, deploy: serving.shift() ?? "a1b2c3d4" };
  };

  await promoteDeploy({
    coreClient,
    state: fakeState(),
    deployId: "a1b2c3d4",
  });

  const upserts = coreCalls
    .filter((c) => c.path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate")
    .map((c) => c.body as EdgeRule);
  const rewrite = upserts.find((r) => r.Description === REWRITE_RULE_DESC);
  expect(rewrite).toMatchObject({
    ActionType: 17,
    ActionParameter1: "10",
    ActionParameter2: "my-site",
    ActionParameter3: "/deploys/a1b2c3d4/",
  });
  expect(rewrite?.ExtraActions?.some((a) => a.ActionType === 6)).toBe(false);

  // Kept probing until the edge reported the new deploy, then purged a second time.
  expect(probed.length).toBe(3);
  expect(probed[0]).toContain("my-site.b-cdn.net");
  const purges = coreCalls.filter(
    (c) => c.path === "/pullzone/{id}/purgeCache",
  );
  expect(purges).toHaveLength(2);
  expect(purges[0]?.params).toEqual({ path: { id: 30 } });

  // A follow-up promote keeps the native zone and changes only its path prefix.
  coreCalls.length = 0;
  promoteVerification.probe = async () => ({ status: 200, deploy: "e5f6" });
  await promoteDeploy({ coreClient, state: fakeState(), deployId: "e5f6" });
  const again = coreCalls
    .filter((c) => c.path === "/pullzone/{pullZoneId}/edgerules/addOrUpdate")
    .map((c) => c.body as EdgeRule)
    .find((r) => r.Description === REWRITE_RULE_DESC);
  expect(again).toMatchObject({
    ActionType: 17,
    ActionParameter1: "10",
    ActionParameter2: "my-site",
    ActionParameter3: "/deploys/e5f6/",
  });
});

// ---- discovery ----

test("fetchSites keeps only storage pull zones whose state names them", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [ZONE],
    pullZones: [
      // A real site.
      {
        Id: 30,
        Name: "my-site",
        StorageZoneId: 10,
        Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
      },
      // A storage pull zone whose state points elsewhere.
      { Id: 32, Name: "other", StorageZoneId: 10 },
      // No storage origin: never a candidate.
      { Id: 33, Name: "url-origin" },
    ],
  });

  const sites = await fetchSites(coreClient);
  expect(sites).toHaveLength(1);
  expect(sites[0]?.state.name).toBe("my-site");
  expect(sites[0]?.systemHostname).toBe("my-site.b-cdn.net");
});

// A pull zone can share a site's storage origin without being the site's own zone; only the state's pullZoneId decides.
test("fetchSites ignores another pull zone pointed at the site's storage zone", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  const coreClient = fakeCoreClient({
    calls: [],
    storageZones: [ZONE],
    pullZones: [
      {
        Id: 30,
        Name: "my-site",
        StorageZoneId: 10,
        Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
      },
      {
        Id: 77,
        Name: "some-other-zone",
        StorageZoneId: 10,
      },
    ],
  });

  const sites = await fetchSites(coreClient);
  expect(sites).toHaveLength(1);
  expect(sites[0]?.state.pullZoneId).toBe(30);
});

test("siteContextFromZone is null for a zone without site state", async () => {
  expect(await siteContextFromZone(ZONE)).toBeNull();
});

// ---- teardown ----

test("deleteSiteResources removes the site marker when keeping storage", async () => {
  store.set(REMOTE_STATE_PATH, JSON.stringify(fakeState()));
  store.set("deploys/aaa/index.html", "<h1>hi</h1>");
  const coreClient = fakeCoreClient({ calls: [] });

  const results = await deleteSiteResources({
    coreClient,
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

test("deleteSiteResources deletes the pull zone and storage zone", async () => {
  const coreCalls: Call[] = [];
  const coreClient = fakeCoreClient({ calls: coreCalls });

  const results = await deleteSiteResources({
    coreClient,
    state: fakeState(),
  });
  expect(results.filter((r) => r.deleted)).toHaveLength(2);
  const deletedPaths = coreCalls
    .filter((c) => c.method === "DELETE")
    .map((c) => c.path);
  expect(deletedPaths).toEqual(["/pullzone/{id}", "/storagezone/{id}"]);
});

// Regression: the live API returns GET /pullzone as a paginated envelope
// ({ Items, CurrentPage, HasMoreItems }); the spec's plain array is a lie
// for some queries (e.g. ?search=). createSite crashed on `.find` here.

test("createSite handles the paginated /pullzone envelope", async () => {
  const coreClient = fakeCoreClient({ calls: [], pullZoneEnvelope: true });

  const result = await createSite({
    coreClient,
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
      { Id: 31, Name: "not-a-site" },
      {
        Id: 30,
        Name: "my-site",
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

// ---- router-era migration ----

function legacyPullZone(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    Id: 30,
    Name: "sites-my-site-abc123",
    StorageZoneId: 10,
    MiddlewareScriptId: 77,
    Hostnames: [{ IsSystemHostname: true, Value: "my-site.b-cdn.net" }],
    ...overrides,
  };
}

function migrateFixture(pullZone?: Record<string, unknown>) {
  const legacy = fakeLegacyState({ current: "abc123", previous: "old999" });
  const raw = JSON.stringify(legacy);
  store.set(REMOTE_STATE_PATH, raw);
  const deletes: Call[] = [];
  return {
    deletes,
    opts: {
      coreClient: fakeCoreClient({
        calls: [],
        storageZones: [ZONE],
        pullZones: [pullZone ?? legacyPullZone()],
      }),
      computeClient: fakeComputeClient(deletes),
      legacy,
      expectedEtag: sha256Hex(raw),
      storageZone: ZONE,
      connection: fakeConnection(),
    },
  };
}

test("migrateSite detaches the router, rules the zone, and rewrites state as version 2", async () => {
  const { opts, deletes } = migrateFixture();

  const result = await migrateSite(opts);

  expect(result.detachedScriptId).toBe(77);
  expect(deletes[0]?.params).toEqual({ path: { id: 77 } });

  expect(JSON.parse(store.get(REMOTE_STATE_PATH) as string)).toEqual({
    version: STATE_VERSION,
    name: "my-site",
    storageZoneId: 10,
    pullZoneId: 30,
    current: "abc123",
    previous: "old999",
    deploys: [],
  });

  const rules = (
    await opts.coreClient.GET("/pullzone/{id}", {
      params: { path: { id: 30 } },
    })
  ).data?.EdgeRules;
  expect(
    rules?.find((r) => r.Description === REWRITE_RULE_DESC)?.ActionParameter3,
  ).toBe("/deploys/abc123/");
  expect(rules?.some((r) => r.Description === GATE_RULE_DESC)).toBe(true);
});

test("migrateSite aborts rather than clobber state that changed mid-migration", async () => {
  const { opts } = migrateFixture();

  // A deploy from an older CLI lands between selection and the version-2 write.
  store.set(
    REMOTE_STATE_PATH,
    JSON.stringify(fakeLegacyState({ current: "newer1" })),
  );

  await expect(migrateSite(opts)).rejects.toThrow(
    "state changed while the migration was running",
  );
  expect((await classifySiteZone(ZONE)).kind).toBe("legacy");
});

test("migrateSite deletes the live script, never the one stale state recorded", async () => {
  // State names 77, but the zone is actually serving 99.
  const attached = migrateFixture(legacyPullZone({ MiddlewareScriptId: 99 }));
  await migrateSite(attached.opts);
  expect(attached.deletes[0]?.params).toEqual({ path: { id: 99 } });

  const detached = migrateFixture(legacyPullZone({ MiddlewareScriptId: null }));
  const result = await migrateSite(detached.opts);
  expect(result.detachedScriptId).toBeNull();
  expect(detached.deletes).toHaveLength(0);
});
