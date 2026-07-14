// `.bunny/site.json` is written by `bunny sites link`/`create` and resolved by sites commands.
export const SITES_MANIFEST = "site.json";

// Remote paths inside the site's storage zone. Everything under `_bunny/` is
// blocked by the router (403), so state never gets served.
export const REMOTE_STATE_PATH = "_bunny/site.json";

// Deploys live at `deploys/{id}/...` inside the storage zone.
export const DEPLOYS_DIR = "deploys";

// Preview hosts are `dpl-{id}.preview.{domain}` — a namespaced wildcard that
// can't shadow user subdomains.
export const PREVIEW_LABEL = "preview";

// The router env var that selects the production deploy. Updating it is the
// promote/rollback lever — no code republish needed.
export const CURRENT_DEPLOY_VAR = "CURRENT_DEPLOY";

export const STATE_VERSION = 1;

export const DEFAULT_KEEP_DEPLOYS = 5;

export interface SiteManifest {
  /** The site's storage zone ID — the site's identity. */
  id: number;
  name?: string;
}

export interface DeployRecord {
  id: string;
  createdAt: string;
  source: "git" | "content";
  gitSha?: string;
  dirty?: boolean;
  /** Hash of the deployed bytes; the no-op check keys on this. Absent on pre-v1 records. */
  contentHash?: string;
  files: number;
  bytes: number;
}

/**
 * The remote site state stored at `_bunny/site.json` in the storage zone.
 * It is the source of truth for what a site is (its resource triple) and
 * what has been deployed; the local `.bunny/site.json` manifest is only a
 * pointer to the storage zone.
 */
export interface RemoteSiteState {
  version: number;
  name: string;
  storageZoneId: number;
  pullZoneId: number;
  scriptId: number;
  routerVersion: number;
  /** Primary custom domain (apex), when one has been attached. */
  domain?: string;
  current?: string;
  previous?: string;
  deploys: DeployRecord[];
}

/** Storage-zone path prefix for a deploy, without a trailing slash. */
export function deployPrefix(deployId: string): string {
  return `${DEPLOYS_DIR}/${deployId}`;
}

/** The preview hostname for a deploy on a custom domain. */
export function previewHostname(deployId: string, domain: string): string {
  return `dpl-${deployId}.${PREVIEW_LABEL}.${domain}`;
}

/** The wildcard hostname that serves every deploy preview on a domain. */
export function previewWildcard(domain: string): string {
  return `*.${PREVIEW_LABEL}.${domain}`;
}

/** Router script name for a site — namespaced so `sites create` can find it on re-run. */
export function routerScriptName(siteName: string): string {
  return `${siteName}-router`;
}

// Deploy IDs are git short-shas or content hashes: lowercase hex-ish tokens.
// The router's preview-host regex and the storage path layout both rely on this.
const DEPLOY_ID_RE = /^[a-z0-9]{4,40}$/;

export function isValidDeployId(id: string): boolean {
  return DEPLOY_ID_RE.test(id);
}

// Site names become storage zone / pull zone names (and the b-cdn.net subdomain).
const SITE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export function isValidSiteName(name: string): boolean {
  return SITE_NAME_RE.test(name);
}

/**
 * Parse and shape-check remote state. Returns null for anything that isn't a
 * state file this CLI understands — a missing field means "not a site", not
 * a crash.
 */
export function parseRemoteState(raw: string): RemoteSiteState | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const s = data as Record<string, unknown>;
  if (
    typeof s.version !== "number" ||
    typeof s.name !== "string" ||
    // A tampered/corrupt name would flow into storage paths and generated CI
    // YAML unquoted; reject state whose name isn't a legal zone name.
    !isValidSiteName(s.name) ||
    typeof s.storageZoneId !== "number" ||
    typeof s.pullZoneId !== "number" ||
    typeof s.scriptId !== "number" ||
    !Array.isArray(s.deploys)
  ) {
    return null;
  }
  const state = s as unknown as RemoteSiteState;
  // Older state files may predate router versioning.
  if (typeof state.routerVersion !== "number") state.routerVersion = 0;
  return state;
}
