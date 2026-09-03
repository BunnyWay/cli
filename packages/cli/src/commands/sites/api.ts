import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { mapWithConcurrency } from "../../core/concurrency.ts";
import {
  type EdgeRule,
  EdgeRuleAction,
  EdgeRuleMatch,
  EdgeRuleTriggerType,
  fetchEdgeRules,
  upsertEdgeRule,
} from "../../core/edge-rules.ts";
import { ApiError, errorMessage, UserError } from "../../core/errors.ts";
import {
  createPullZone,
  setForceSsl,
  systemHostname,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import {
  type CoreClient,
  fetchStorageZone,
  type StorageZoneModel,
} from "../storage/api.ts";
import {
  type ZoneTierChoice,
  zoneTierChoice,
  zoneTierLabel,
  zoneTierValue,
} from "../storage/constants.ts";
import {
  connectStorageZone,
  deleteFile,
  downloadFile,
  type StorageZone,
  uploadFile,
} from "../storage/files-api.ts";
import {
  ASSET_BROWSER_TTL_SECONDS,
  ASSET_EXTENSION_GROUPS,
  ASSETS_RULE_DESC,
  DEPLOY_HEADER,
  DEPLOYS_DIR,
  deployPrefix,
  GATE_RULE_DESC,
  type LegacySiteState,
  migrateLegacyState,
  PLACEHOLDER_DEPLOY,
  parseLegacyState,
  parseRemoteState,
  REMOTE_STATE_PATH,
  REWRITE_RULE_DESC,
  type RemoteSiteState,
  STATE_RULE_DESC,
  STATE_VERSION,
  siteResourcePattern,
  suffixedResourceName,
} from "./constants.ts";

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

export interface SiteSummaryOf<S> {
  state: S;
  storageZone: StorageZoneModel;
  systemHostname?: string;
}

export type SiteSummary = SiteSummaryOf<RemoteSiteState>;

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

/** Read `_bunny/site.json` unparsed, so a caller can try more than one state format against it.
 * Returns null when the file isn't there. */
export function readRawState(connection: StorageZone): Promise<string | null> {
  return downloadText(connection, REMOTE_STATE_PATH);
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

/** What a zone's `_bunny/site.json` turned out to be.
 * The three cases want three different answers, so the migrate path reads the file
 *  once and tries both formats rather than asking "is this a site?". */
export type ZoneState =
  | { kind: "legacy"; state: LegacySiteState }
  | { kind: "current"; state: RemoteSiteState }
  | { kind: "none" };

/** Classify a storage zone by the state format it carries. */
export async function classifySiteZone(
  zone: StorageZoneModel,
): Promise<ZoneState> {
  const raw = await readRawState(siteFiles.connect(zone));
  if (raw === null) return { kind: "none" };
  const legacy = parseLegacyState(raw);
  if (legacy) return { kind: "legacy", state: legacy };
  const current = parseRemoteState(raw);
  if (current) return { kind: "current", state: current };
  return { kind: "none" };
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

async function scanSites<S extends { name: string; pullZoneId: number }>(
  client: CoreClient,
  parse: (raw: string) => S | null,
): Promise<Array<SiteSummaryOf<S>>> {
  const candidates = (await fetchPullZones(client)).filter(
    (pz: PullZone) => pz.StorageZoneId != null,
  );

  const summaries = await mapWithConcurrency(
    candidates,
    8,
    async (pz: PullZone): Promise<SiteSummaryOf<S> | null> => {
      try {
        const zone = await fetchStorageZone(client, pz.StorageZoneId as number);
        const raw = await readRawState(siteFiles.connect(zone));
        const state = raw === null ? null : parse(raw);
        if (!state || state.pullZoneId !== pz.Id) return null;
        return {
          state,
          storageZone: zone,
          systemHostname: systemHostname(pz.Hostnames),
        };
      } catch {
        return null;
      }
    },
  );

  return summaries
    .filter((s): s is SiteSummaryOf<S> => s !== null)
    .sort((a, b) => a.state.name.localeCompare(b.state.name));
}

export async function fetchSites(client: CoreClient): Promise<SiteSummary[]> {
  return scanSites(client, parseRemoteState);
}

/** Router-era sites, which {@link fetchSites} can't see because their state no longer parses; `sites migrate` discovers them with this. */
export async function fetchLegacySites(
  client: CoreClient,
): Promise<Array<SiteSummaryOf<LegacySiteState>>> {
  return scanSites(client, parseLegacyState);
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

// Edge caches everything (purged on publish); browsers revalidate everything (max-age=0) except what the assets rule overrides.
const SITE_CACHE_SETTINGS = {
  CacheControlMaxAgeOverride: 2592000,
  CacheControlPublicMaxAgeOverride: 0,
};

/** Apply the site cache policy to a pull zone. Unlike the edge rules this isn't reapplied on every publish, so a zone provisioned before it existed needs {@link migrateSite} to set it. */
export async function applySiteCacheSettings(
  coreClient: CoreClient,
  pullZoneId: number,
): Promise<void> {
  await coreClient.POST("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
    body: SITE_CACHE_SETTINGS,
  });
}

// `0` is the API's "no middleware script" sentinel on update. `null` is accepted and silently ignored, and `-1` (which the API itself reports for an unlinked `EdgeScriptId`) is rejected as a missing script, so neither can be used to clear the field.
const NO_MIDDLEWARE_SCRIPT = 0;

// Detach the pull zone's middleware script, returning the script that was attached (null when there was none, so a resumed migration is a no-op). The clear is verified rather than assumed: a silently ignored detach would leave the router rewriting into `*/deploys/*`, which the gate rule blocks, and the site would serve 403s.
export async function detachMiddlewareScript(
  coreClient: CoreClient,
  pullZoneId: number,
): Promise<number | null> {
  const attached = await fetchMiddlewareScriptId(coreClient, pullZoneId);
  if (attached == null) return null;
  await coreClient.POST("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
    body: { MiddlewareScriptId: NO_MIDDLEWARE_SCRIPT },
  });
  if ((await fetchMiddlewareScriptId(coreClient, pullZoneId)) != null) {
    throw new UserError(
      `Couldn't detach edge script ${attached} from pull zone ${pullZoneId}.`,
      "Remove the linked edge script from the pull zone in the dashboard, then re-run this command.",
    );
  }
  return attached;
}

async function fetchMiddlewareScriptId(
  coreClient: CoreClient,
  pullZoneId: number,
): Promise<number | null> {
  const { data } = await coreClient.GET("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
  });
  const id = data?.MiddlewareScriptId;
  // A detached zone reports the field as absent, but treat the sentinel as unset too rather than trust one shape.
  return id == null || id === NO_MIDDLEWARE_SCRIPT ? null : id;
}

// The four rules that serve a site; bodies are always rebuilt in full from these so a hand-edited rule heals on the next upsert.
function siteRules(
  storageZone: { Id: number; Name: string },
  deployId: string,
): Array<EdgeRule & { Description: string }> {
  const deploysPattern = `*/${DEPLOYS_DIR}/*`;
  return [
    {
      Description: REWRITE_RULE_DESC,
      Enabled: true,
      ActionType: EdgeRuleAction.OriginStorage,
      ActionParameter1: String(storageZone.Id),
      ActionParameter2: storageZone.Name,
      ActionParameter3: `/${deployPrefix(deployId)}/`,
      ExtraActions: [
        {
          ActionType: EdgeRuleAction.SetResponseHeader,
          ActionParameter1: DEPLOY_HEADER,
          ActionParameter2: deployId,
        },
      ],
      TriggerMatchingType: EdgeRuleMatch.Any,
      Triggers: [
        {
          Type: EdgeRuleTriggerType.Url,
          PatternMatches: [deploysPattern],
          PatternMatchingType: EdgeRuleMatch.None,
        },
      ],
    },
    {
      Description: GATE_RULE_DESC,
      Enabled: true,
      ActionType: EdgeRuleAction.BlockRequest,
      TriggerMatchingType: EdgeRuleMatch.Any,
      Triggers: [
        {
          Type: EdgeRuleTriggerType.Url,
          PatternMatches: [deploysPattern],
          PatternMatchingType: EdgeRuleMatch.Any,
        },
      ],
    },
    {
      Description: STATE_RULE_DESC,
      Enabled: true,
      ActionType: EdgeRuleAction.BlockRequest,
      TriggerMatchingType: EdgeRuleMatch.Any,
      Triggers: [
        {
          Type: EdgeRuleTriggerType.Url,
          PatternMatches: ["*/_bunny/*"],
          PatternMatchingType: EdgeRuleMatch.Any,
        },
      ],
    },
    ...ASSET_EXTENSION_GROUPS.map((extensions, i) => ({
      Description: `${ASSETS_RULE_DESC} (${i + 1})`,
      Enabled: true,
      ActionType: EdgeRuleAction.OverrideBrowserCacheTime,
      ActionParameter1: String(ASSET_BROWSER_TTL_SECONDS),
      TriggerMatchingType: EdgeRuleMatch.Any,
      Triggers: [
        {
          Type: EdgeRuleTriggerType.UrlExtension,
          PatternMatches: [...extensions],
          PatternMatchingType: EdgeRuleMatch.Any,
        },
      ],
    })),
  ];
}

// Converge the pull zone's rules on `deployId`; create and promote both funnel through here, so a missing or stale rule heals on any run.
export async function ensureSiteRules(opts: {
  coreClient: CoreClient;
  pullZoneId: number;
  storageZone: StorageZoneModel;
  deployId: string;
}): Promise<void> {
  const { coreClient, pullZoneId, storageZone, deployId } = opts;
  const { Id: storageZoneId, Name: storageZoneName } = storageZone;
  if (storageZoneId == null || !storageZoneName) {
    throw new UserError("The site's storage zone is missing its ID or name.");
  }
  const existing = await fetchEdgeRules(coreClient, pullZoneId);
  for (const rule of siteRules(
    { Id: storageZoneId, Name: storageZoneName },
    deployId,
  )) {
    await upsertEdgeRule(coreClient, pullZoneId, rule, existing);
  }
}

export interface CreateSiteOptions {
  coreClient: CoreClient;
  name: string;
  /** Explicitly requested region; a fresh zone falls back to DE, and a resumed zone must already be in it. */
  region?: string;
  tier?: ZoneTierChoice;
  /** Progress callback; drives the spinner text. */
  onStep?: (message: string) => void;
}

export interface CreateSiteResult {
  state: RemoteSiteState;
  storageZone: StorageZoneModel;
  systemHostname?: string;
  reused: { storageZone: boolean; pullZone: boolean };
}

// Provision a site (storage zone -> placeholder -> pull zone -> cache settings + edge rules -> state); each step looks up by name first so a half-finished create re-runs cleanly, and a zone already carrying state is never re-provisioned.
export async function createSite(
  opts: CreateSiteOptions,
): Promise<CreateSiteResult> {
  const { coreClient, name, region, tier } = opts;
  const step = opts.onStep ?? (() => {});
  const reused = { storageZone: false, pullZone: false };

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
    // Tier is fixed at creation, so a resumed zone can't be moved to the requested one; say so instead of finishing on the wrong tier.
    if (tier && zoneTierChoice(storageZone) !== tier) {
      throw new UserError(
        `A half-finished site zone for "${name}" is on the ${zoneTierLabel(storageZone, "long")} tier, but \`--tier ${tier}\` was requested.`,
        `Storage tier can't be changed after a zone is created. Re-run with \`--tier ${zoneTierChoice(storageZone)}\` (or without \`--tier\`) to resume it, or delete storage zone "${storageZone.Name}" to start over.`,
      );
    }
    // The primary region is fixed at creation too; only an explicit --region mismatch is an error, so a flagless retry resumes the zone where it is.
    if (region && storageZone.Region && storageZone.Region !== region) {
      throw new UserError(
        `A half-finished site zone for "${name}" is in the ${storageZone.Region} region, but \`--region ${region}\` was requested.`,
        `Storage region can't be changed after a zone is created. Re-run with \`--region ${storageZone.Region}\` (or without \`--region\`) to resume it, or delete storage zone "${storageZone.Name}" to start over.`,
      );
    }
    reused.storageZone = true;
  } else {
    // The suffix keeps the globally-unique name from colliding with other accounts; retry fresh suffixes on the off chance one still does.
    for (let attempt = 0; !storageZone && attempt < 3; attempt++) {
      const zoneName = suffixedResourceName(name);
      try {
        const { data } = await coreClient.POST("/storagezone", {
          body: {
            Name: zoneName,
            Region: region ?? "DE",
            ReplicationRegions: null,
            ZoneTier: tier ? zoneTierValue(tier) : undefined,
          },
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

  // 2. Pull zone with the storage origin.
  // Named like the storage zone; a fresh suffix on collision keeps the create moving (nothing keys on the names matching).
  step("Creating pull zone...");
  const resourceName = storageZone.Name ?? name;
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

  // 3. Cache settings + edge rules, immediately after the zone exists: an unruled zone serves the raw storage origin.
  step("Configuring edge rules...");
  const systemHost = systemHostname(pullZone.Hostnames);
  if (!systemHost) {
    throw new UserError(
      `Pull zone "${resourceName}" has no system hostname.`,
      "Re-run the command to finish provisioning.",
    );
  }
  await applySiteCacheSettings(coreClient, pullZone.Id);
  await ensureSiteRules({
    coreClient,
    pullZoneId: pullZone.Id,
    storageZone,
    deployId: PLACEHOLDER_DEPLOY,
  });

  // Force HTTPS on the <name>.b-cdn.net system host (already on bunny's wildcard cert, so this just redirects HTTP); best-effort.
  try {
    await setForceSsl(coreClient, pullZone.Id, systemHost, true);
  } catch (err) {
    logger.warn(`Couldn't force HTTPS on ${systemHost}: ${errorMessage(err)}`);
  }

  // 4. Remote state; from here on the zone identifies as a site.
  step("Writing site state...");
  const connection = siteFiles.connect(storageZone);
  const state: RemoteSiteState = {
    version: STATE_VERSION,
    name,
    storageZoneId,
    pullZoneId: pullZone.Id,
    deploys: [],
  };
  // A fresh zone's credentials propagate asynchronously and refuse writes for the first seconds; retry briefly instead of failing the create.
  for (let attempt = 0; ; attempt++) {
    try {
      await writeRemoteState(connection, state);
      break;
    } catch (err) {
      if (attempt >= 5 || !/unauthorized/i.test(errorMessage(err))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

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

const PROBE_TIMEOUT_MS = 4000;
const PROPAGATION_DEADLINE_MS = 20_000;
const PROPAGATION_INTERVAL_MS = 1500;
// Config syncs bundle in ~5s buckets, so the floor must outlast one bucket or the final purge can race a lagging node.
const SETTLE_FLOOR_MS = 7500;

export const promoteVerification = {
  /** Probe the live site through the CDN; resolves to the status and the serving deploy id. */
  probe: async (
    url: string,
  ): Promise<{ status: number; deploy: string | null }> => {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      status: res.status,
      deploy: res.headers.get(DEPLOY_HEADER),
    };
  },
  wait: (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms)),
};

// Wait until the edge serves the promoted deploy, identified by the rewrite rule's response header.
async function waitForEdgePropagation(
  host: string,
  deployId: string,
): Promise<void> {
  const start = Date.now();
  const deadline = start + PROPAGATION_DEADLINE_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      // A unique query per attempt keeps each probe out of the CDN cache so a stale entry can't mask a propagated rule.
      const { deploy } = await promoteVerification.probe(
        `https://${host}/?__bunny_promote=${deployId}-${attempt++}`,
      );
      if (deploy === deployId) break;
    } catch {
      // Edge briefly unreachable (DNS/warmup); keep trying until the deadline.
    }
    await promoteVerification.wait(PROPAGATION_INTERVAL_MS);
  }
  // Let the rule reach every node before the follow-up purge, so re-promotes don't re-cache the outgoing deploy's files.
  const elapsed = Date.now() - start;
  if (elapsed < SETTLE_FLOOR_MS) {
    await promoteVerification.wait(SETTLE_FLOOR_MS - elapsed);
  }
}

// Point production at a deploy: retarget the rewrite rule and purge. The rule propagates async, so purge, wait for the edge to serve it, then purge again so nothing stale survives (the header can confirm on a cached response, which is why the second purge is load-bearing).
export async function promoteDeploy(opts: {
  coreClient: CoreClient;
  state: RemoteSiteState;
  deployId: string;
}): Promise<void> {
  const { coreClient, state, deployId } = opts;
  const purge = () =>
    coreClient.POST("/pullzone/{id}/purgeCache", {
      params: { path: { id: state.pullZoneId } },
      body: {},
    });

  const [host, storageZone] = await Promise.all([
    fetchSystemHostname(coreClient, state.pullZoneId),
    fetchStorageZone(coreClient, state.storageZoneId),
  ]);
  if (!host) {
    throw new UserError(
      "Couldn't resolve the site's hostname to publish.",
      "Re-run the command; the pull zone may still be provisioning.",
    );
  }
  await ensureSiteRules({
    coreClient,
    pullZoneId: state.pullZoneId,
    storageZone,
    deployId,
  });
  await purge();
  await waitForEdgePropagation(host, deployId);
  await purge();
}

export interface MigrateResult {
  state: RemoteSiteState;
  /** The edge script detached from the pull zone, or null when it already was. */
  detachedScriptId: number | null;
  /** The deploy the rewrite rule now targets; the placeholder when the site never published one. */
  deployId: string;
  scriptDeleted: boolean;
  /** Why the script survived, when deleting it failed; the migration itself still succeeded. */
  scriptError?: string;
}
export async function migrateSite(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  legacy: LegacySiteState;
  storageZone: StorageZoneModel;
  connection: StorageZone;
  keepScript?: boolean;
  onStep?: (message: string) => void;
}): Promise<MigrateResult> {
  const { coreClient, computeClient, legacy, storageZone, connection } = opts;
  const step = opts.onStep ?? (() => {});
  const state = migrateLegacyState(legacy);
  const deployId = state.current ?? PLACEHOLDER_DEPLOY;

  step("Detaching the router script...");
  const detachedScriptId = await detachMiddlewareScript(
    coreClient,
    state.pullZoneId,
  );

  step("Applying edge rules...");
  await ensureSiteRules({
    coreClient,
    pullZoneId: state.pullZoneId,
    storageZone,
    deployId,
  });
  await applySiteCacheSettings(coreClient, state.pullZoneId);

  step("Writing site state...");
  await writeRemoteState(connection, state);

  if (state.current) {
    step("Publishing the current deploy...");
    await promoteDeploy({ coreClient, state, deployId: state.current });
  }

  let scriptDeleted = false;
  let scriptError: string | undefined;
  if (!opts.keepScript) {
    step("Deleting the router script...");
    try {
      await computeClient.DELETE("/compute/script/{id}", {
        params: { path: { id: legacy.scriptId } },
      });
      scriptDeleted = true;
    } catch (err) {
      scriptError = errorMessage(err);
    }
  }

  return { state, detachedScriptId, deployId, scriptDeleted, scriptError };
}

export interface TeardownResult {
  resource: "pull zone" | "storage zone";
  id: number;
  deleted: boolean;
  error?: string;
}

// Tear down a site's resources; the pull zone references the storage zone so it goes first, and each step is best-effort so a partial delete can be re-run.
export async function deleteSiteResources(opts: {
  coreClient: CoreClient;
  state: RemoteSiteState;
  keepStorage?: boolean;
  /** The storage connection; needed to tombstone the site marker with --keep-storage. */
  connection?: StorageZone;
}): Promise<TeardownResult[]> {
  const { coreClient, state } = opts;
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

  await attempt("pull zone", state.pullZoneId, () =>
    coreClient.DELETE("/pullzone/{id}", {
      params: { path: { id: state.pullZoneId } },
    }),
  );
  if (opts.keepStorage) {
    // The zone survives, so remove its site marker, else list/link/show rediscover a "site" whose pull zone is gone. But only once everything else deleted: the marker is what makes a re-run able to find and retry the failures.
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
  try {
    await siteFiles.remove(connection, `${deployPrefix(deployId)}/`);
  } catch (err) {
    // An absent prefix is already the goal (a fresh ID, or a re-run after a partial delete).
    if (!isNotFoundError(err)) throw err;
  }
}
