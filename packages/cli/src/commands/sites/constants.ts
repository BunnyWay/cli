// `.bunny/site.json` is written by `bunny sites link`/`create` and resolved by sites commands.
export const SITES_MANIFEST = "site.json";

// Site state path; everything under `_bunny/` is blocked by an edge rule so state is never served.
export const REMOTE_STATE_PATH = "_bunny/site.json";

// Deploys live at `deploys/{id}/...` inside the storage zone.
export const DEPLOYS_DIR = "deploys";

// Version 2 dropped the router script; version-1 states (router-era) still parse so delete/list keep working on them.
export const STATE_VERSION = 2;

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
  /** Hash of the deployed bytes; the no-op check keys on this. */
  contentHash: string;
  files: number;
  bytes: number;
}

// Source of truth (at `_bunny/site.json`) for a site's resource pair and deploys; `.bunny/site.json` is just a local pointer to it.
export interface RemoteSiteState {
  version: number;
  name: string;
  storageZoneId: number;
  pullZoneId: number;
  /** Router-era (version 1) sites only; presence marks a site the retired script architecture serves. */
  scriptId?: number;
  /** Custom production domain, when one has been attached. */
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

// The rewrite rule's initial target; nothing is uploaded there, so an undeployed site serves storage 404s. The underscore keeps it outside the deploy-id alphabet (IDs must start alphanumeric).
export const PLACEHOLDER_DEPLOY = "_placeholder";

export const HOP_HEADER = "X-Bunny-Site-Hop";
export const DEPLOY_HEADER = "X-Bunny-Deploy";

// Edge rules are identified by these descriptions; upserts key on them, so treat them as frozen.
export const REWRITE_RULE_DESC = "bunny sites: serve the published deploy";
export const GATE_RULE_DESC = "bunny sites: block direct deploy access";
export const STATE_RULE_DESC = "bunny sites: block site state access";
export const ASSETS_RULE_DESC = "bunny sites: browser-cache static assets";

// Browser-cache TTL for static assets (1 day); HTML stays at the zone-level max-age=0 so new deploys show immediately.
export const ASSET_BROWSER_TTL_SECONDS = 86400;

// The API caps a condition at 5 patterns, so extensions ship as one rule per group; anything uncovered just revalidates against the edge cache.
export const ASSET_EXTENSION_GROUPS = [
  ["css", "js", "mjs", "woff2", "svg"],
  ["png", "jpg", "jpeg", "webp", "ico"],
];

/** Per-site secret authenticating the rewrite rule's internal hop to the deploy files. */
export function randomHopSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Deploy IDs are git short-shas or content hashes (lowercase hex-ish); the edge rules and storage paths rely on this.
const DEPLOY_ID_RE = /^[a-z0-9]{4,40}$/;

export function isValidDeployId(id: string): boolean {
  return DEPLOY_ID_RE.test(id);
}

// Site names become `sites-{name}-{suffix}` zone names; 3-47 chars keeps those within zone-name limits.
const SITE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,45}[a-z0-9]$/;

export function isValidSiteName(name: string): boolean {
  return SITE_NAME_RE.test(name);
}

// Marks the zones as sites-managed in the dashboard; discovery doesn't key on it (that's pull zone shape + state).
export const RESOURCE_PREFIX = "sites-";

const RESOURCE_SUFFIX_LENGTH = 6;
const RESOURCE_SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Zone names are global across bunny.net, so the random suffix keeps creates from colliding with other accounts' zones.
export function randomResourceSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RESOURCE_SUFFIX_LENGTH));
  return Array.from(
    bytes,
    (b) => RESOURCE_SUFFIX_CHARS[b % RESOURCE_SUFFIX_CHARS.length],
  ).join("");
}

/** A site's storage/pull zone name: `sites-{name}-{suffix}`. */
export function suffixedResourceName(siteName: string): string {
  return `${RESOURCE_PREFIX}${siteName}-${randomResourceSuffix()}`;
}

/** Matches a site's zone names: `sites-{name}-{suffix}`. */
export function siteResourcePattern(siteName: string): RegExp {
  return new RegExp(
    `^${RESOURCE_PREFIX}${siteName}-[a-z0-9]{${RESOURCE_SUFFIX_LENGTH}}$`,
    "i",
  );
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
    // A future format is rejected rather than misread; older CLIs lacked this bound, which is why version 2 couldn't rely on it.
    s.version > STATE_VERSION ||
    typeof s.name !== "string" ||
    // Reject an illegal name: it would flow unquoted into storage paths and generated CI YAML.
    !isValidSiteName(s.name) ||
    typeof s.storageZoneId !== "number" ||
    typeof s.pullZoneId !== "number" ||
    (s.scriptId !== undefined && typeof s.scriptId !== "number") ||
    !Array.isArray(s.deploys)
  ) {
    return null;
  }
  return s as unknown as RemoteSiteState;
}
