// `.bunny/site.json` is written by `bunny sites link`/`create` and resolved by sites commands.
export const SITES_MANIFEST = "site.json";

// Site state path; everything under `_bunny/` is router-blocked (403) so state is never served.
export const REMOTE_STATE_PATH = "_bunny/site.json";

// Deploys live at `deploys/{id}/...` inside the storage zone.
export const DEPLOYS_DIR = "deploys";

// Preview hosts are `dpl-{id}.preview.{domain}`; a namespaced wildcard that can't shadow user subdomains.
export const PREVIEW_LABEL = "preview";

// Router env var selecting the production deploy; updating it is the promote/rollback lever (no republish).
export const CURRENT_DEPLOY_VAR = "CURRENT_DEPLOY";

export const STATE_VERSION = 1;

export const DEFAULT_KEEP_DEPLOYS = 5;

export interface SiteManifest {
  /** The site's storage zone ID; the site's identity. */
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

// Source of truth (at `_bunny/site.json`) for a site's resource triple and deploys; `.bunny/site.json` is just a local pointer to it.
export interface RemoteSiteState {
  version: number;
  name: string;
  storageZoneId: number;
  pullZoneId: number;
  scriptId: number;
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

/** Point production at `deployId`, remembering the outgoing deploy as previous. */
export function markCurrent(state: RemoteSiteState, deployId: string): void {
  if (state.current && state.current !== deployId) {
    state.previous = state.current;
  }
  state.current = deployId;
}

/** Pick the deploys beyond the newest `keep`, never the current or previous. */
export function pruneVictims(
  deploys: DeployRecord[],
  keep: number,
  current?: string,
  previous?: string,
): DeployRecord[] {
  const sorted = [...deploys].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return sorted
    .slice(Math.max(0, keep))
    .filter((d) => d.id !== current && d.id !== previous);
}

/** The preview hostname for a deploy on a custom domain. */
export function previewHostname(deployId: string, domain: string): string {
  return `dpl-${deployId}.${PREVIEW_LABEL}.${domain}`;
}

/** The wildcard hostname that serves every deploy preview on a domain. */
export function previewWildcard(domain: string): string {
  return `*.${PREVIEW_LABEL}.${domain}`;
}

/** Router script name for a site; namespaced so `sites create` can find it on re-run. */
export function routerScriptName(siteName: string): string {
  return `${siteName}-router`;
}

// Deploy IDs are git short-shas or content hashes (lowercase hex-ish); the router regex and storage paths rely on this.
const DEPLOY_ID_RE = /^[a-z0-9]{4,40}$/;

export function isValidDeployId(id: string): boolean {
  return DEPLOY_ID_RE.test(id);
}

// Site names become storage zone / pull zone names (and the b-cdn.net subdomain).
const SITE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export function isValidSiteName(name: string): boolean {
  return SITE_NAME_RE.test(name);
}

// Parse and shape-check remote state; returns null (not a crash) for anything that isn't a state file this CLI understands.
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
    // Reject an illegal name: it would flow unquoted into storage paths and generated CI YAML.
    !isValidSiteName(s.name) ||
    typeof s.storageZoneId !== "number" ||
    typeof s.pullZoneId !== "number" ||
    typeof s.scriptId !== "number" ||
    !Array.isArray(s.deploys)
  ) {
    return null;
  }
  return s as unknown as RemoteSiteState;
}
