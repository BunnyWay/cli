import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { mapWithConcurrency } from "../../core/concurrency.ts";
import { ApiError, errorMessage, UserError } from "../../core/errors.ts";
import {
  createPullZone,
  setForceSsl,
  systemHostname,
} from "../../core/hostnames/index.ts";
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
  deployIdFromPreviewZoneName,
  deployPrefix,
  isPreviewZoneName,
  PREVIEW_ZONE_PREFIX,
  parseRemoteState,
  previewZoneName,
  REMOTE_STATE_PATH,
  type RemoteSiteState,
  routerScriptName,
  STATE_VERSION,
  siteResourcePattern,
  suffixedResourceName,
} from "./constants.ts";
import { ROUTER_VERSION, routerSource } from "./router/source.ts";

export type ComputeClient = ReturnType<typeof createComputeClient>;
type PullZone = components["schemas"]["PullZoneModel"];

// Storage-file IO seam; tests swap these for an in-memory store (bun's `mock.module` leaks across files, this doesn't).
export const siteFiles = {
  connect: connectStorageZone,
  download: downloadFile,
  upload: uploadFile,
  remove: deleteFile,
};

/** Everything a sites command needs once the site is resolved. */
export interface SiteContext {
  state: RemoteSiteState;
  /** Checksum of the state as read; the optimistic lock for writes. */
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

// Only a genuine 404 means "no file"; 401/timeout/5xx must propagate so ownership checks never fail open.
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

// Write `_bunny/site.json` (returns the new etag). On an `expectedEtag` mismatch a parseable concurrent state is reconciled: deploy records merge (minus any `removedIds` this writer intentionally deleted, so a prune racing a deploy doesn't resurrect pruned records), and the current/previous pointers follow `promotedTo` (last promote wins; a non-promoting writer adopts the concurrent pointers rather than clobber them with its stale read). An unparseable conflict aborts rather than overwrite.
export async function writeRemoteState(
  connection: StorageZone,
  state: RemoteSiteState,
  expectedEtag?: string,
  opts?: {
    /** Deploy this writer just promoted to production; omit when the write doesn't change `current`. */
    promotedTo?: string;
    /** Deploy IDs this writer intentionally removed (e.g. prune); the conflict merge must not resurrect them from concurrent state. */
    removedIds?: readonly string[];
  },
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
      const removed = new Set(opts?.removedIds ?? []);
      state.deploys = [
        ...state.deploys,
        ...remote.deploys.filter((d) => !ours.has(d.id) && !removed.has(d.id)),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (opts?.promotedTo) {
        // Our promote wins (it set CURRENT_DEPLOY last), and the concurrent writer's production deploy becomes the rollback target.
        state.current = opts.promotedTo;
        state.previous =
          remote.current && remote.current !== opts.promotedTo
            ? remote.current
            : remote.previous;
      } else {
        state.current = remote.current;
        state.previous = remote.previous;
      }
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

const PULL_ZONE_PAGE_SIZE = 1000;

interface PullZonePage {
  Items?: PullZone[];
  CurrentPage?: number;
  HasMoreItems?: boolean;
}

// List pull zones, tolerating both response shapes: the plain array the spec documents, and the `{ Items, CurrentPage, HasMoreItems }` envelope the live API returns for some queries.
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

// Discover sites: a pull zone listing narrows to storage+middleware candidates (preview zones share that shape, so their name pattern skips them), only those get the per-zone `_bunny/site.json` read.
export async function fetchSites(client: CoreClient): Promise<SiteSummary[]> {
  const candidates = (await fetchPullZones(client)).filter(
    (pz: PullZone) =>
      pz.MiddlewareScriptId != null &&
      pz.StorageZoneId != null &&
      !isPreviewZoneName(pz.Name),
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
          systemHostname: systemHostname(pz.Hostnames),
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

// Account storage zones whose name is `sites-{name}-{suffix}`, re-fetched by ID because search results may omit the zone password.
async function findSiteStorageZones(
  client: CoreClient,
  name: string,
): Promise<StorageZoneModel[]> {
  const { data } = await client.GET("/storagezone", {
    params: { query: { search: name } },
  });
  const pattern = siteResourcePattern(name);
  const matches = (data ?? []).filter((zone) => pattern.test(zone.Name ?? ""));
  return Promise.all(
    matches
      .filter((zone) => zone.Id != null)
      .map((zone) => fetchStorageZone(client, zone.Id as number)),
  );
}

// The site's pull zone on a resumed create: the name-pattern match already pointing at the storage zone.
async function findSitePullZone(
  client: CoreClient,
  name: string,
  storageZoneId: number,
): Promise<PullZone | undefined> {
  const pattern = siteResourcePattern(name);
  return (await fetchPullZones(client, name)).find(
    (pz) => pattern.test(pz.Name ?? "") && pz.StorageZoneId === storageZoneId,
  );
}

// The globally-unique name is taken (often by another account, so the pre-create lookup missed it): a 409, or a 400 whose message says so.
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
  /** Progress callback; drives the spinner text. */
  onStep?: (message: string) => void;
}

export interface CreateSiteResult {
  state: RemoteSiteState;
  storageZone: StorageZoneModel;
  systemHostname?: string;
  reused: { storageZone: boolean; script: boolean; pullZone: boolean };
}

// Provision a site (storage zone -> router script -> pull zone + router -> state); each step looks up by name first so a half-finished create re-runs cleanly, and a zone already carrying state is never re-provisioned.
export async function createSite(
  opts: CreateSiteOptions,
): Promise<CreateSiteResult> {
  const { coreClient, computeClient, name, region } = opts;
  const step = opts.onStep ?? (() => {});
  const reused = { storageZone: false, script: false, pullZone: false };

  // 1. Storage zone; the site's identity.
  // A stateless name-pattern match is a half-finished create to resume; one carrying this site's state already is the site.
  step("Creating storage zone...");
  let storageZone: StorageZoneModel | undefined;
  for (const zone of await findSiteStorageZones(coreClient, name)) {
    const existing = await siteContextFromZone(zone);
    if (existing?.state.name === name) {
      throw new UserError(
        `Site "${name}" already exists.`,
        `Run \`bunny sites link ${name}\` to use it from this directory.`,
      );
    }
    if (!existing && !storageZone) storageZone = zone;
  }
  if (storageZone) {
    reused.storageZone = true;
  } else {
    // The suffix keeps the globally-unique name from colliding with other accounts; retry fresh suffixes on the off chance one still does.
    for (let attempt = 0; !storageZone && attempt < 3; attempt++) {
      const zoneName = suffixedResourceName(name);
      try {
        const { data } = await coreClient.POST("/storagezone", {
          body: { Name: zoneName, Region: region, ReplicationRegions: null },
        });
        if (!data?.Id) {
          throw new UserError(`Failed to create storage zone "${zoneName}".`);
        }
        // Re-fetch for the full record (including the zone password).
        storageZone = await fetchStorageZone(coreClient, data.Id);
      } catch (err) {
        if (!isNameTaken(err)) throw err;
      }
    }
    if (!storageZone) {
      throw new UserError(
        `Couldn't find an available storage zone name for "${name}".`,
        "Re-run the command, or choose a different site name.",
      );
    }
  }
  const storageZoneId = storageZone.Id;
  if (storageZoneId == null) {
    throw new UserError(`Storage zone "${name}" has no ID.`);
  }

  // 2. Router script (middleware); code/publish/env-var are idempotent, so they always run and a resumed create converges.
  // Named after the zone so a resume finds it.
  step("Creating router script...");
  const resourceName = storageZone.Name ?? name;
  const scriptName = routerScriptName(resourceName);
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
    body: { Code: routerSource },
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
  // Namd like the storage zone; a fresh suffix on collision keeps the create moving(nothing keys on the names matching).
  step("Creating pull zone...");
  let pullZone = await findSitePullZone(coreClient, name, storageZoneId);
  if (pullZone) {
    reused.pullZone = true;
  } else {
    let pullZoneName = resourceName;
    for (let attempt = 0; !pullZone && attempt < 3; attempt++) {
      try {
        pullZone = await createPullZone(
          coreClient,
          pullZoneName,
          storageZoneId,
        );
      } catch (err) {
        if (!isNameTaken(err)) throw err;
        pullZoneName = suffixedResourceName(name);
      }
    }
    if (!pullZone) {
      throw new UserError(
        `Couldn't find an available pull zone name for "${name}".`,
        "Re-run the command, or choose a different site name.",
      );
    }
  }
  if (pullZone.Id == null) {
    throw new UserError(`Pull zone "${name}" has no ID.`);
  }
  await coreClient.POST("/pullzone/{id}", {
    params: { path: { id: pullZone.Id } },
    body: { MiddlewareScriptId: scriptId },
  });

  // Force HTTPS on the <name>.b-cdn.net system host (already on bunny's wildcard cert, so this just redirects HTTP); best-effort.
  const systemHost = systemHostname(pullZone.Hostnames);
  if (systemHost) {
    try {
      await setForceSsl(coreClient, pullZone.Id, systemHost, true);
    } catch (err) {
      logger.warn(
        `Couldn't force HTTPS on ${systemHost}: ${errorMessage(err)}`,
      );
    }
  }

  // 4. Remote state; from here on the zone identifies as a site.
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
    systemHostname: systemHostname(pullZone.Hostnames),
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
    return systemHostname(data?.Hostnames);
  } catch {
    return undefined;
  }
}

// Republish the site's router when its recorded source generation lags the CLI's (pre-preview-zone routers would silently serve production on preview hostnames). Mutates state.routerVersion; the caller's next state write persists it, and a missed write just re-runs this next time.
export async function ensureRouterCurrent(opts: {
  computeClient: ComputeClient;
  state: RemoteSiteState;
}): Promise<boolean> {
  const { computeClient, state } = opts;
  // Only upgrade: a site touched by a newer CLI must not be downgraded to this binary's older source (e.g. a pinned CI action racing a newer local CLI).
  if ((state.routerVersion ?? 0) >= ROUTER_VERSION) return false;
  await computeClient.POST("/compute/script/{id}/code", {
    params: { path: { id: state.scriptId } },
    body: { Code: routerSource },
  });
  await computeClient.POST("/compute/script/{id}/publish", {
    params: { path: { id: state.scriptId, uuid: null } },
    body: {},
  });
  state.routerVersion = ROUTER_VERSION;
  return true;
}

// Every deploy gets its own preview pull zone: the site's storage origin + router, served at `sites-dpl-{id}-{suffix}.b-cdn.net` (instant HTTPS, no DNS or certificate setup). A zone left over from a failed state write is adopted by name + storage-zone match, so retries converge instead of piling up zones.
export async function ensurePreviewZone(opts: {
  coreClient: CoreClient;
  state: RemoteSiteState;
  deployId: string;
}): Promise<{ id: number; host: string } | null> {
  const { coreClient, state, deployId } = opts;

  const host = (pz: PullZone) =>
    systemHostname(pz.Hostnames) ?? `${pz.Name}.b-cdn.net`;

  try {
    // Adopt an orphan before creating: same deploy, same storage zone, preview-shaped name.
    let zone: PullZone | undefined = (
      await fetchPullZones(coreClient, `${PREVIEW_ZONE_PREFIX}${deployId}-`)
    ).find(
      (pz) =>
        deployIdFromPreviewZoneName(pz.Name) === deployId &&
        pz.StorageZoneId === state.storageZoneId &&
        pz.Id != null,
    );

    for (let attempt = 0; !zone && attempt < 3; attempt++) {
      try {
        zone = await createPullZone(
          coreClient,
          previewZoneName(deployId),
          state.storageZoneId,
        );
      } catch (err) {
        // Another account owns the random name; a fresh suffix next round.
        if (!isNameTaken(err)) throw err;
      }
    }
    if (!zone?.Id) return null;

    // The router attach is part of the ready contract for created AND adopted zones: an orphan whose attach failed on the previous run would otherwise serve the raw storage root (every deploy plus _bunny/) at the advertised URL. Idempotent, so re-running on a configured zone is safe.
    await coreClient.POST("/pullzone/{id}", {
      params: { path: { id: zone.Id } },
      body: { MiddlewareScriptId: state.scriptId },
    });
    // Redirect HTTP to HTTPS on the b-cdn.net host (already certified); best-effort, and retried here whenever a zone is adopted.
    const systemHost = systemHostname(zone.Hostnames);
    if (systemHost) {
      await setForceSsl(coreClient, zone.Id, systemHost, true).catch(() => {});
    }
    return { id: zone.Id, host: host(zone) };
  } catch (err) {
    logger.warn(
      `Couldn't set up a preview zone for ${deployId}: ${errorMessage(err)}`,
    );
    return null;
  }
}

/** Every preview zone backed by this site's storage zone, discovered by name shape (covers zones missing from state after a failed write). */
export async function findPreviewZones(
  coreClient: CoreClient,
  storageZoneId: number,
): Promise<Array<{ id: number; deployId: string }>> {
  const zones = await fetchPullZones(coreClient, PREVIEW_ZONE_PREFIX);
  return zones.flatMap((pz) => {
    const deployId = deployIdFromPreviewZoneName(pz.Name);
    if (!deployId || pz.StorageZoneId !== storageZoneId || pz.Id == null) {
      return [];
    }
    return [{ id: pz.Id as number, deployId }];
  });
}

/** Delete a preview pull zone; returns false (with a warning) instead of throwing, so cleanup sweeps keep going. A zone that's already gone counts as deleted, so retries converge. */
export async function deletePreviewZone(
  coreClient: CoreClient,
  id: number,
): Promise<boolean> {
  try {
    await coreClient.DELETE("/pullzone/{id}", { params: { path: { id } } });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return true;
    logger.warn(`Couldn't delete preview zone ${id}: ${errorMessage(err)}`);
    return false;
  }
}

const PROBE_TIMEOUT_MS = 4000;
const PROPAGATION_DEADLINE_MS = 20_000;
const PROPAGATION_INTERVAL_MS = 1500;
const SETTLE_FLOOR_MS = 2500;

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

// Wait until the edge serves a real deploy: the router's "no deploys yet" 404 means CURRENT_DEPLOY is unset/unpropagated, so any non-404 means it landed; best-effort (skip probing when the host can't be resolved).
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
        // A unique query per attempt keeps each probe out of the CDN cache so a stale placeholder can't mask a propagated deploy.
        const status = await promoteVerification.probe(
          `https://${host}/?__bunny_promote=${deployId}-${attempt++}`,
        );
        if (status !== 404) break;
      } catch {
        // Edge briefly unreachable (DNS/warmup); keep trying until the deadline.
      }
      await promoteVerification.wait(PROPAGATION_INTERVAL_MS);
    }
  }
  // Let the env var reach every node before the follow-up purge, so re-promotes don't re-cache the outgoing deploy's assets.
  const elapsed = Date.now() - start;
  if (elapsed < SETTLE_FLOOR_MS) {
    await promoteVerification.wait(SETTLE_FLOOR_MS - elapsed);
  }
}

// Point production at a deploy: set CURRENT_DEPLOY (no republish) and purge. Since the env var propagates async, we purge, wait for the edge to serve it, then purge again so nothing stale survives.
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
  resource: "preview zone" | "pull zone" | "router script" | "storage zone";
  id: number;
  deleted: boolean;
  error?: string;
}

// Tear down a site's resources; the pull zones reference the script and storage zone so they go first (previews before the main zone), and each step is best-effort so a partial delete can be re-run.
export async function deleteSiteResources(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  state: RemoteSiteState;
  keepStorage?: boolean;
  /** The storage connection; needed to tombstone the site marker with --keep-storage. */
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
      results.push({ resource, id, deleted: false, error: errorMessage(err) });
    }
  };

  // Preview zones: the recorded ids plus a name-shape sweep, so zones a failed state write orphaned still go. The sweep needs the storage zone (it's the association key), so a failed listing aborts before anything is torn down; the whole delete is retryable.
  const previewZoneIds = new Set(
    state.deploys.flatMap((d) => (d.previewZoneId ? [d.previewZoneId] : [])),
  );
  try {
    for (const zone of await findPreviewZones(coreClient, state.storageZoneId))
      previewZoneIds.add(zone.id);
  } catch (err) {
    throw new UserError(
      `Couldn't list the site's preview zones: ${errorMessage(err)}`,
      "Nothing was deleted; re-run the command.",
    );
  }
  for (const id of previewZoneIds) {
    await attempt("preview zone", id, () =>
      coreClient.DELETE("/pullzone/{id}", { params: { path: { id } } }),
    );
  }

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
    // The zone survives, so remove its site marker, else list/link/show rediscover a "site" whose pull zone and router are gone. But only once everything else deleted: the marker is what makes a re-run able to find and retry the failures.
    if (opts.connection && results.every((r) => r.deleted)) {
      try {
        await siteFiles.remove(opts.connection, REMOTE_STATE_PATH);
      } catch (err) {
        logger.warn(
          `Kept the storage zone but couldn't remove its site marker (${REMOTE_STATE_PATH}): ${errorMessage(err)}`,
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
  await siteFiles.remove(connection, `${deployPrefix(deployId)}/`);
}
