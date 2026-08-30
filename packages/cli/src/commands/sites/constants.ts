// `.bunny/site.json` is written by `bunny sites link`/`create` and resolved by sites commands.
export const SITES_MANIFEST = "site.json";

// Site state path; everything under `_bunny/` is router-blocked (403) so state is never served.
export const REMOTE_STATE_PATH = "_bunny/site.json";

// Deploys live at `deploys/{id}/...` inside the storage zone.
export const DEPLOYS_DIR = "deploys";

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
  /** How the ID was chosen; "custom" means the caller supplied it with --deploy-id. */
  source: "git" | "content" | "custom";
  gitSha?: string;
  dirty?: boolean;
  /** Hash of the deployed bytes; the no-op check keys on this. */
  contentHash: string;
  files: number;
  bytes: number;
  /**
   * Set while the deploy's files are being written, cleared once they all
   * landed. A record still pending was interrupted (or is being written right
   * now), so its prefix cannot be trusted to hold what `contentHash` says:
   * deploy re-uploads it rather than no-op'ing, and publish refuses it.
   */
  pending?: boolean;
}

// Source of truth (at `_bunny/site.json`) for a site's resource triple and deploys; `.bunny/site.json` is just a local pointer to it.
export interface RemoteSiteState {
  version: number;
  name: string;
  storageZoneId: number;
  pullZoneId: number;
  scriptId: number;
  /** Custom production domain, when one has been attached. */
  domain?: string;
  /** The router source generation last published to the script; deploy republishes when it lags ROUTER_VERSION. */
  routerVersion?: number;
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

/** Router script name for a site; namespaced so `sites create` can find it on re-run. */
export function routerScriptName(siteName: string): string {
  return `${siteName}-router`;
}

// A deploy ID becomes a storage path and the router's CURRENT_DEPLOY, so its charset is a boundary, not a style choice: alphanumerics plus `-`, `_` and `.`, bounded by an alphanumeric, and never a traversal sequence. Case is preserved rather than folded: a caller-supplied ID exists to match whatever produced the deploy, and the ID never reaches a client-facing URL (the router builds the origin path itself), so nothing downstream needs it normalized.
const DEPLOY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,62}[A-Za-z0-9]$/;

/** Why an ID is unusable, or null when it's fine. Phrased to complete "Deploy ID ...". */
export function deployIdError(id: string): string | null {
  if (id.length < 4 || id.length > 64) return "must be 4 to 64 characters";
  if (id.includes("..")) return 'must not contain ".."';
  if (!DEPLOY_ID_RE.test(id)) {
    return "may use only letters, digits, and -, _ or ., and must start and end with a letter or digit";
  }
  return null;
}

export function isValidDeployId(id: string): boolean {
  return deployIdError(id) === null;
}

/**
 * Look up a deploy by ID, exactly.
 *
 * `caseVariant` is the deploy that differs only in case, so a caller can say
 * "did you mean" instead of a bare not-found: IDs preserve the case they were
 * given, and eyeballing `Release-42` against `release-42` in a list is no fun.
 */
export function findDeploy(
  deploys: DeployRecord[],
  id: string,
): { deploy?: DeployRecord; caseVariant?: DeployRecord } {
  const deploy = deploys.find((d) => d.id === id);
  if (deploy) return { deploy };
  const lower = id.toLowerCase();
  return { caseVariant: deploys.find((d) => d.id.toLowerCase() === lower) };
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
