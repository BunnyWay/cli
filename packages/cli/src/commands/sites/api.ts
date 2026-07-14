import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { ApiError, UserError } from "../../core/errors.ts";
import { createPullZone, setForceSsl } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { fetchScripts } from "../scripts/api.ts";
import { SCRIPT_TYPE_MIDDLEWARE } from "../scripts/constants.ts";
import {
  type CoreClient,
  fetchStorageZone,
  type StorageZoneModel,
} from "../storage/api.ts";
import {
  connectStorageZone,
  deleteFile,
  downloadFile,
  type StorageZone,
  uploadFile,
} from "../storage/files-api.ts";
import {
  CURRENT_DEPLOY_VAR,
  parseRemoteState,
  REMOTE_STATE_PATH,
  type RemoteSiteState,
  routerScriptName,
  STATE_VERSION,
} from "./constants.ts";
import { ROUTER_VERSION, routerSource } from "./router/source.ts";

export type ComputeClient = ReturnType<typeof createComputeClient>;
type PullZone = components["schemas"]["PullZoneModel"];

/**
 * The storage-file IO seam. Everything sites reads/writes in a storage zone
 * goes through here so tests can swap the entries for an in-memory store
 * (bun's `mock.module` leaks across test files; this doesn't).
 */
export const siteFiles = {
  connect: connectStorageZone,
  download: downloadFile,
  upload: uploadFile,
  remove: deleteFile,
};

/** Everything a sites command needs once the site is resolved. */
export interface SiteContext {
  state: RemoteSiteState;
  /** Checksum of the state as read — the optimistic lock for writes. */
  etag: string;
  storageZone: StorageZoneModel;
  connection: StorageZone;
}

export interface SiteSummary {
  state: RemoteSiteState;
  storageZone: StorageZoneModel;
  systemHostname?: string;
}

export function sha256Hex(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

/**
 * The storage SDK throws a plain Error whose message encodes the HTTP status
 * (`File not found: ...` for a 404). Only a genuine 404 means "no file"; a
 * 401/timeout/5xx must propagate so ownership checks never fail open.
 */
function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message);
}

async function downloadText(
  connection: StorageZone,
  path: string,
): Promise<string | null> {
  try {
    const { stream } = await siteFiles.download(connection, path);
    return await new Response(stream).text();
  } catch (err) {
    // A missing file reads as "no data"; transient/permission errors must
    // propagate so a caller can't clobber a live site's state on a bad read.
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

function textStream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

/** Read `_bunny/site.json`. Returns null when the zone isn't a site. */
export async function readRemoteState(
  connection: StorageZone,
): Promise<{ state: RemoteSiteState; etag: string } | null> {
  const raw = await downloadText(connection, REMOTE_STATE_PATH);
  if (raw === null) return null;
  const state = parseRemoteState(raw);
  if (!state) return null;
  return { state, etag: sha256Hex(raw) };
}

/**
 * Write `_bunny/site.json`. When `expectedEtag` is given, the current remote
 * content is re-read first; a mismatch means someone else deployed since we
 * read (e.g. concurrent CI runs). If the concurrent state is parseable, their
 * deploy records are merged in so no deploy goes missing and our
 * `current`/`previous` win (last promote wins). If it's unparseable we abort
 * rather than blindly overwrite unknown state. Returns the new etag.
 */
export async function writeRemoteState(
  connection: StorageZone,
  state: RemoteSiteState,
  expectedEtag?: string,
): Promise<string> {
  if (expectedEtag) {
    const current = await downloadText(connection, REMOTE_STATE_PATH);
    if (current !== null && sha256Hex(current) !== expectedEtag) {
      const remote = parseRemoteState(current);
      if (!remote) {
        throw new UserError(
          "Remote site state changed since it was read and is no longer parseable.",
          "Another process may be writing it. Re-run the command.",
        );
      }
      const ours = new Set(state.deploys.map((d) => d.id));
      state.deploys = [
        ...state.deploys,
        ...remote.deploys.filter((d) => !ours.has(d.id)),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      logger.warn(
        "Remote site state changed since it was read (concurrent deploy?): merged deploy records.",
      );
    }
  }
  const raw = `${JSON.stringify(state, null, 2)}\n`;
  await siteFiles.upload(connection, REMOTE_STATE_PATH, textStream(raw), {
    sha256Checksum: sha256Hex(raw).toUpperCase(),
  });
  return sha256Hex(raw);
}

export async function siteContextFromZone(
  zone: StorageZoneModel,
): Promise<SiteContext | null> {
  const connection = siteFiles.connect(zone);
  const remote = await readRemoteState(connection);
  if (!remote) return null;
  return { ...remote, storageZone: zone, connection };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

const PULL_ZONE_PAGE_SIZE = 1000;

interface PullZonePage {
  Items?: PullZone[];
  CurrentPage?: number;
  HasMoreItems?: boolean;
}

/**
 * List pull zones, tolerating both response shapes: the plain array the
 * OpenAPI spec documents, and the `{ Items, CurrentPage, HasMoreItems }`
 * envelope the live API actually returns for some queries (e.g. `search`).
 */
async function fetchPullZones(
  client: CoreClient,
  search?: string,
): Promise<PullZone[]> {
  const all: PullZone[] = [];
  let page: number | undefined;
  while (true) {
    const { data } = await client.GET("/pullzone", {
      params: {
        query: {
          ...(search !== undefined ? { search } : {}),
          ...(page !== undefined ? { page } : {}),
          perPage: PULL_ZONE_PAGE_SIZE,
        },
      },
    });

    const raw = data as unknown;
    if (Array.isArray(raw)) {
      // A plain array is the complete result set.
      all.push(...(raw as PullZone[]));
      return all;
    }

    const envelope = (raw ?? {}) as PullZonePage;
    const items = envelope.Items ?? [];
    all.push(...items);
    // Empty page guards against a server that never clears HasMoreItems.
    if (!envelope.HasMoreItems || items.length === 0) return all;
    page = (envelope.CurrentPage ?? 0) + 1;
  }
}

/**
 * Discover the account's sites.
 *
 * A site is a storage-backed pull zone with a middleware script whose storage
 * zone carries a matching `_bunny/site.json`. One pull zone listing narrows
 * the candidates; only those get the per-zone state read.
 */
export async function fetchSites(client: CoreClient): Promise<SiteSummary[]> {
  const candidates = (await fetchPullZones(client)).filter(
    (pz: PullZone) => pz.MiddlewareScriptId != null && pz.StorageZoneId != null,
  );

  const summaries = await mapWithConcurrency(
    candidates,
    8,
    async (pz: PullZone): Promise<SiteSummary | null> => {
      try {
        const zone = await fetchStorageZone(client, pz.StorageZoneId as number);
        const context = await siteContextFromZone(zone);
        if (!context || context.state.pullZoneId !== pz.Id) return null;
        return {
          state: context.state,
          storageZone: zone,
          systemHostname:
            (pz.Hostnames ?? []).find((h) => h.IsSystemHostname)?.Value ??
            undefined,
        };
      } catch {
        return null;
      }
    },
  );

  return summaries
    .filter((s): s is SiteSummary => s !== null)
    .sort((a, b) => a.state.name.localeCompare(b.state.name));
}

async function findStorageZoneByName(
  client: CoreClient,
  name: string,
): Promise<StorageZoneModel | undefined> {
  const { data } = await client.GET("/storagezone", {
    params: { query: { search: name } },
  });
  const match = (data ?? []).find(
    (zone) => (zone.Name ?? "").toLowerCase() === name.toLowerCase(),
  );
  // Re-fetch by ID: search results may omit the zone password.
  return match?.Id ? fetchStorageZone(client, match.Id) : undefined;
}

async function findPullZoneByName(
  client: CoreClient,
  name: string,
): Promise<PullZone | undefined> {
  return (await fetchPullZones(client, name)).find(
    (pz) => (pz.Name ?? "").toLowerCase() === name.toLowerCase(),
  );
}

/**
 * A create failed because the globally-unique name is already taken (usually by
 * another account, so the pre-create by-name lookup couldn't see it). Reported
 * as a 409, or on some endpoints a 400 whose message says the name is in use.
 */
function isNameTaken(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 409) return true;
  return (
    err.status === 400 &&
    /already (exists|taken|in use)|not available|is taken/i.test(err.message)
  );
}

export interface CreateSiteOptions {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  name: string;
  region: string;
  /** Progress callback — drives the spinner text. */
  onStep?: (message: string) => void;
}

export interface CreateSiteResult {
  state: RemoteSiteState;
  storageZone: StorageZoneModel;
  systemHostname?: string;
  reused: { storageZone: boolean; script: boolean; pullZone: boolean };
}

/**
 * Provision a site: storage zone → router script (middleware) → storage-backed
 * pull zone with the router attached → remote state. Every step looks up the
 * resource by name before creating it, so a half-finished create re-runs
 * cleanly. A storage zone that already carries site state is an existing site
 * and is never re-provisioned.
 */
export async function createSite(
  opts: CreateSiteOptions,
): Promise<CreateSiteResult> {
  const { coreClient, computeClient, name, region } = opts;
  const step = opts.onStep ?? (() => {});
  const reused = { storageZone: false, script: false, pullZone: false };

  // 1. Storage zone — the site's identity.
  step("Creating storage zone...");
  let storageZone = await findStorageZoneByName(coreClient, name);
  if (storageZone) {
    const existing = await siteContextFromZone(storageZone);
    if (existing) {
      throw new UserError(
        `Site "${name}" already exists.`,
        `Run \`bunny sites link ${name}\` to use it from this directory.`,
      );
    }
    reused.storageZone = true;
  } else {
    let data: StorageZoneModel | undefined;
    try {
      ({ data } = await coreClient.POST("/storagezone", {
        body: { Name: name, Region: region, ReplicationRegions: null },
      }));
    } catch (err) {
      if (isNameTaken(err)) {
        throw new UserError(
          `The storage zone name "${name}" is already taken.`,
          "Storage zone names are global across bunny.net. Choose a different site name.",
        );
      }
      throw err;
    }
    if (!data?.Id) {
      throw new UserError(`Failed to create storage zone "${name}".`);
    }
    // Re-fetch for the full record (including the zone password).
    storageZone = await fetchStorageZone(coreClient, data.Id);
  }
  const storageZoneId = storageZone.Id;
  if (storageZoneId == null) {
    throw new UserError(`Storage zone "${name}" has no ID.`);
  }

  // 2. Router script (middleware). Code upload + publish + env var are all
  // idempotent PUTs/POSTs, so they always run — a resumed create converges.
  step("Creating router script...");
  const scriptName = routerScriptName(name);
  let scriptId = (await fetchScripts(computeClient)).find(
    (s) => s.Name === scriptName,
  )?.Id;
  if (scriptId != null) {
    reused.script = true;
  } else {
    const { data: script } = await computeClient.POST("/compute/script", {
      body: {
        Name: scriptName,
        ScriptType: SCRIPT_TYPE_MIDDLEWARE,
        CreateLinkedPullZone: false,
      },
    });
    if (script?.Id == null) {
      throw new UserError(`Failed to create router script "${scriptName}".`);
    }
    scriptId = script.Id;
  }

  step("Publishing router...");
  await computeClient.POST("/compute/script/{id}/code", {
    params: { path: { id: scriptId } },
    body: { Code: routerSource() },
  });
  await computeClient.POST("/compute/script/{id}/publish", {
    params: { path: { id: scriptId, uuid: null } },
    body: {},
  });
  await computeClient.PUT("/compute/script/{id}/variables", {
    params: { path: { id: scriptId } },
    body: { Name: CURRENT_DEPLOY_VAR, DefaultValue: "" },
  });

  // 3. Pull zone with the storage origin, router attached.
  step("Creating pull zone...");
  let pullZone = await findPullZoneByName(coreClient, name);
  if (pullZone) {
    reused.pullZone = true;
  } else {
    try {
      pullZone = await createPullZone(coreClient, name, storageZoneId);
    } catch (err) {
      if (isNameTaken(err)) {
        throw new UserError(
          `The pull zone name "${name}" is already taken.`,
          "Pull zone names are global across bunny.net. Choose a different site name.",
        );
      }
      throw err;
    }
  }
  if (pullZone.Id == null) {
    throw new UserError(`Pull zone "${name}" has no ID.`);
  }
  await coreClient.POST("/pullzone/{id}", {
    params: { path: { id: pullZone.Id } },
    body: { MiddlewareScriptId: scriptId },
  });

  // Force HTTPS on the <name>.b-cdn.net system host: it already carries bunny's
  // wildcard cert, so this just redirects HTTP. Best-effort — never fail create.
  const systemHostname = (pullZone.Hostnames ?? []).find(
    (h) => h.IsSystemHostname,
  )?.Value;
  if (systemHostname) {
    try {
      await setForceSsl(coreClient, pullZone.Id, systemHostname, true);
    } catch (err) {
      logger.warn(
        `Couldn't force HTTPS on ${systemHostname}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 4. Remote state — from here on the zone identifies as a site.
  step("Writing site state...");
  const state: RemoteSiteState = {
    version: STATE_VERSION,
    name,
    storageZoneId,
    pullZoneId: pullZone.Id,
    scriptId,
    routerVersion: ROUTER_VERSION,
    deploys: [],
  };
  const connection = siteFiles.connect(storageZone);
  await writeRemoteState(connection, state);

  return {
    state,
    storageZone,
    systemHostname:
      (pullZone.Hostnames ?? []).find((h) => h.IsSystemHostname)?.Value ??
      undefined,
    reused,
  };
}

/** The pull zone's system hostname (`*.b-cdn.net`), or undefined on any failure. */
export async function fetchSystemHostname(
  coreClient: CoreClient,
  pullZoneId: number,
): Promise<string | undefined> {
  try {
    const { data } = await coreClient.GET("/pullzone/{id}", {
      params: { path: { id: pullZoneId } },
    });
    return (
      (data?.Hostnames ?? []).find((h) => h.IsSystemHostname)?.Value ??
      undefined
    );
  } catch {
    return undefined;
  }
}

// Promote timing. `CURRENT_DEPLOY` is accepted by the control plane instantly
// but reaches the edge nodes asynchronously, so we confirm the edge is serving
// a deploy before the follow-up purge, then settle briefly so the value has
// landed everywhere.
const PROBE_TIMEOUT_MS = 4000;
const PROPAGATION_DEADLINE_MS = 20_000;
const PROPAGATION_INTERVAL_MS = 1500;
const SETTLE_FLOOR_MS = 2500;

/**
 * The CDN-probe seam. Tests swap these so promote runs without real network or
 * real timers.
 */
export const promoteVerification = {
  /** Probe the live site through the CDN; resolves to the HTTP status code. */
  probe: async (url: string): Promise<number> => {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.status;
  },
  wait: (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Wait until the edge serves a real deploy for this site. The router returns
 * the "no deploys yet" placeholder as a 404 while `CURRENT_DEPLOY` is unset or
 * unpropagated, so any non-404 means a deploy is being served. Best-effort: if
 * the system hostname can't be resolved we skip probing and just settle.
 */
async function waitForEdgePropagation(
  coreClient: CoreClient,
  state: RemoteSiteState,
  deployId: string,
): Promise<void> {
  const host = await fetchSystemHostname(coreClient, state.pullZoneId);
  const start = Date.now();
  if (host) {
    const deadline = start + PROPAGATION_DEADLINE_MS;
    let attempt = 0;
    while (Date.now() < deadline) {
      try {
        // A unique query per attempt keeps each probe out of the CDN cache so a
        // stale placeholder can't mask a propagated deploy.
        const status = await promoteVerification.probe(
          `https://${host}/?__bunny_promote=${deployId}-${attempt++}`,
        );
        if (status !== 404) break;
      } catch {
        // Edge briefly unreachable (DNS/warmup) — keep trying until the deadline.
      }
      await promoteVerification.wait(PROPAGATION_INTERVAL_MS);
    }
  }
  // Give the env var a moment to reach every node before the follow-up purge,
  // so re-promotes don't re-cache the outgoing deploy's assets.
  const elapsed = Date.now() - start;
  if (elapsed < SETTLE_FLOOR_MS) {
    await promoteVerification.wait(SETTLE_FLOOR_MS - elapsed);
  }
}

/**
 * Point production at a deploy: update the router's `CURRENT_DEPLOY` env var
 * (takes effect without republishing code) and purge the pull zone cache.
 *
 * The env var reaches the edge asynchronously, so a single purge races it: a
 * request during the propagation window re-caches the old deploy (or, on a
 * first deploy, the 404 placeholder — the "styles broken until it settles"
 * failure). We purge, wait for the edge to serve the deploy, then purge again
 * so nothing stale survives.
 */
export async function promoteDeploy(opts: {
  computeClient: ComputeClient;
  coreClient: CoreClient;
  state: RemoteSiteState;
  deployId: string;
}): Promise<void> {
  const purge = () =>
    opts.coreClient.POST("/pullzone/{id}/purgeCache", {
      params: { path: { id: opts.state.pullZoneId } },
      body: {},
    });

  await opts.computeClient.PUT("/compute/script/{id}/variables", {
    params: { path: { id: opts.state.scriptId } },
    body: { Name: CURRENT_DEPLOY_VAR, DefaultValue: opts.deployId },
  });
  await purge();
  await waitForEdgePropagation(opts.coreClient, opts.state, opts.deployId);
  await purge();
}

export interface TeardownResult {
  resource: "pull zone" | "router script" | "storage zone";
  id: number;
  deleted: boolean;
  error?: string;
}

/**
 * Tear down a site's resources. Order matters: the pull zone references both
 * the script and the storage zone, so it goes first. Each step is best-effort
 * so a partially-deleted site can be re-deleted.
 */
export async function deleteSiteResources(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  state: RemoteSiteState;
  keepStorage?: boolean;
  /** The storage connection — needed to tombstone the site marker with --keep-storage. */
  connection?: StorageZone;
}): Promise<TeardownResult[]> {
  const { coreClient, computeClient, state } = opts;
  const results: TeardownResult[] = [];

  const attempt = async (
    resource: TeardownResult["resource"],
    id: number,
    fn: () => Promise<unknown>,
  ) => {
    try {
      await fn();
      results.push({ resource, id, deleted: true });
    } catch (err) {
      results.push({
        resource,
        id,
        deleted: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await attempt("pull zone", state.pullZoneId, () =>
    coreClient.DELETE("/pullzone/{id}", {
      params: { path: { id: state.pullZoneId } },
    }),
  );
  await attempt("router script", state.scriptId, () =>
    computeClient.DELETE("/compute/script/{id}", {
      params: { path: { id: state.scriptId } },
    }),
  );
  if (opts.keepStorage) {
    // The zone survives, so remove its site marker — otherwise list/link/show
    // rediscover a "site" whose pull zone and router are already gone.
    if (opts.connection) {
      try {
        await siteFiles.remove(opts.connection, REMOTE_STATE_PATH);
      } catch (err) {
        logger.warn(
          `Kept the storage zone but couldn't remove its site marker (${REMOTE_STATE_PATH}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  } else {
    await attempt("storage zone", state.storageZoneId, () =>
      coreClient.DELETE("/storagezone/{id}", {
        params: { path: { id: state.storageZoneId } },
      }),
    );
  }

  return results;
}

export async function deleteDeployFiles(
  connection: StorageZone,
  deployId: string,
): Promise<void> {
  await siteFiles.remove(connection, `deploys/${deployId}/`);
}
