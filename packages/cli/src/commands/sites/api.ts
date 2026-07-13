import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "../../core/errors.ts";
import { createPullZone } from "../../core/hostnames/index.ts";
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

async function downloadText(
  connection: StorageZone,
  path: string,
): Promise<string | null> {
  try {
    const { stream } = await siteFiles.download(connection, path);
    return await new Response(stream).text();
  } catch {
    // Missing file and transient errors both read as "no data" — callers
    // that need to distinguish should not be writing based on this alone.
    return null;
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
 * read (e.g. concurrent CI runs). Their deploy records are merged in so no
 * deploy goes missing; our `current`/`previous` win (last promote wins).
 * Returns the new etag.
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
      if (remote) {
        const ours = new Set(state.deploys.map((d) => d.id));
        state.deploys = [
          ...state.deploys,
          ...remote.deploys.filter((d) => !ours.has(d.id)),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        logger.warn(
          "Remote site state changed since it was read (concurrent deploy?): merged deploy records.",
        );
      } else {
        logger.warn(
          "Remote site state changed since it was read (concurrent deploy?): overwriting.",
        );
      }
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
    const { data } = await coreClient.POST("/storagezone", {
      body: { Name: name, Region: region, ReplicationRegions: null },
    });
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
    pullZone = await createPullZone(coreClient, name, storageZoneId);
  }
  if (pullZone.Id == null) {
    throw new UserError(`Pull zone "${name}" has no ID.`);
  }
  await coreClient.POST("/pullzone/{id}", {
    params: { path: { id: pullZone.Id } },
    body: { MiddlewareScriptId: scriptId },
  });

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

/**
 * Point production at a deploy: update the router's `CURRENT_DEPLOY` env var
 * (takes effect without republishing code) and purge the pull zone cache.
 */
export async function promoteDeploy(opts: {
  computeClient: ComputeClient;
  coreClient: CoreClient;
  state: RemoteSiteState;
  deployId: string;
}): Promise<void> {
  await opts.computeClient.PUT("/compute/script/{id}/variables", {
    params: { path: { id: opts.state.scriptId } },
    body: { Name: CURRENT_DEPLOY_VAR, DefaultValue: opts.deployId },
  });
  await opts.coreClient.POST("/pullzone/{id}/purgeCache", {
    params: { path: { id: opts.state.pullZoneId } },
    body: {},
  });
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
  if (!opts.keepStorage) {
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
