// `.bunny/site.json` is written by `bunny sites link`/`create` and resolved by sites commands.
export const SITES_MANIFEST = "site.json";

// Site state path; everything under `_bunny/` is blocked by an edge rule so state is never served.
export const REMOTE_STATE_PATH = "_bunny/site.json";

// Deploys live at `deploys/{id}/...` inside the storage zone.
export const DEPLOYS_DIR = "deploys";

// State format version; only this exact version parses, so `sites migrate` rewrites version 1 into it.
export const STATE_VERSION = 2;

export const LEGACY_STATE_VERSION = 1;

export const DEFAULT_KEEP_DEPLOYS = 5;

export interface SiteManifest {
  /** The site's storage zone ID; the site's identity. */
  id: number;
  name?: string;
}

/** `spa` serves index.html as a 200 for extensionless misses; `404` serves the deploy's 404.html; absent is the storage 404 page. */
export type NotFoundMode = "spa" | "404";

export interface DeployRecord {
  id: string;
  createdAt: string;
  notFound?: NotFoundMode;
  /** How the ID was chosen; "custom" means the caller supplied it with --deploy-id. */
  source: "git" | "content" | "custom";
  gitSha?: string;
  dirty?: boolean;
  /** Hash of the deployed bytes; the no-op check keys on this. */
  contentHash: string;
  files: number;
  bytes: number;
}

// A function deployed with the site: its own standalone Edge Script behind its linked pull zone, which the frontend calls by URL.
export interface FunctionRecord {
  scriptId: number;
  pullZoneId?: number;
  /** The function's own pull zone host; the frontend calls it directly. */
  hostname: string;
  /** Hash of the uploaded code; an unchanged function skips its upload. */
  codeHash?: string;
}

// Source of truth (at `_bunny/site.json`) for a site's resource pair and deploys; `.bunny/site.json` is just a local pointer to it.
export interface RemoteSiteState {
  version: number;
  name: string;
  storageZoneId: number;
  pullZoneId: number;
  /** Custom production domain, when one has been attached. */
  domain?: string;
  current?: string;
  previous?: string;
  deploys: DeployRecord[];
  /** Functions by name; absent on sites without any. */
  functions?: Record<string, FunctionRecord>;
}

/** Router-era (version 1) state; the current format plus the script fields, which is all the migration has to drop. */
export interface LegacySiteState {
  version: number;
  name: string;
  storageZoneId: number;
  pullZoneId: number;
  scriptId: number;
  routerVersion?: number;
  domain?: string;
  current?: string;
  previous?: string;
  deploys: DeployRecord[];
}

/** Storage-zone path prefix for a deploy, without a trailing slash. */
export function deployPrefix(deployId: string): string {
  return `${DEPLOYS_DIR}/${deployId}`;
}

// Zone-wide, so these retarget with the rewrite rule on every publish; the API ignores null, only an empty path clears it.
export function notFoundSettings(
  deployId: string,
  mode: NotFoundMode | undefined,
): { Custom404FilePath: string; Rewrite404To200: boolean } {
  if (mode === "spa") {
    return {
      Custom404FilePath: `/${deployPrefix(deployId)}/index.html`,
      Rewrite404To200: true,
    };
  }
  if (mode === "404") {
    return {
      Custom404FilePath: `/${deployPrefix(deployId)}/404.html`,
      Rewrite404To200: false,
    };
  }
  return { Custom404FilePath: "", Rewrite404To200: false };
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

export const DEPLOY_HEADER = "X-Bunny-Deploy";

// Edge rules are identified by these descriptions; upserts key on them, so treat them as frozen.
export const REWRITE_RULE_DESC = "bunny sites: serve the published deploy";
export const GATE_RULE_DESC = "bunny sites: block direct deploy access";
export const STATE_RULE_DESC = "bunny sites: block site state access";
export const ASSETS_RULE_DESC = "bunny sites: browser-cache static assets";

/** Where the frontend reaches a function: its own pull zone, called cross-origin. */
export function functionUrl(hostname: string): string {
  return `https://${hostname}`;
}

/** Build-time variable carrying a function's URL, e.g. BUNNY_FUNCTION_CREATE_SHARE_URL. */
export function functionEnvName(name: string, prefix = ""): string {
  return `${prefix}BUNNY_FUNCTION_${name.toUpperCase().replace(/-/g, "_")}_URL`;
}

// Browser-cache TTL for static assets (1 day); HTML stays at the zone-level max-age=0 so new deploys show immediately.
export const ASSET_BROWSER_TTL_SECONDS = 86400;

// The API caps a condition at 5 patterns, so extensions ship as one rule per group; anything uncovered just revalidates against the edge cache.
export const ASSET_EXTENSION_GROUPS = [
  ["css", "js", "mjs", "woff2", "svg"],
  ["png", "jpg", "jpeg", "webp", "ico"],
  // Runtimes and models are the largest files a site ships, and fonts the most repeated.
  ["wasm", "onnx", "woff", "ttf", "otf"],
];

// A deploy ID becomes a storage path and the rewrite rule's origin target, so its charset is a boundary, not a style choice: alphanumerics plus `-`, `_` and `.`, bounded by an alphanumeric (which also keeps the `_placeholder` sentinel unreachable), and never a traversal sequence. Case is preserved rather than folded: a caller-supplied ID exists to match whatever produced the deploy, and the ID never reaches a client-facing URL (the rule builds the origin path itself), so nothing downstream needs it normalized.
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

function stateObject(raw: string): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function hasCommonShape(s: Record<string, unknown>): boolean {
  return (
    typeof s.name === "string" &&
    // Reject an illegal name: it would flow unquoted into storage paths and generated CI YAML.
    isValidSiteName(s.name) &&
    typeof s.storageZoneId === "number" &&
    typeof s.pullZoneId === "number" &&
    Array.isArray(s.deploys)
  );
}

// Parse and shape-check remote state; returns null (not a crash) for anything that isn't a state file this CLI understands.
export function parseRemoteState(raw: string): RemoteSiteState | null {
  const s = stateObject(raw);
  // Any other version is rejected rather than misread; version 1 goes through `sites migrate` first.
  if (!s || s.version !== STATE_VERSION || !hasCommonShape(s)) return null;
  return s as unknown as RemoteSiteState;
}

// Returns null for every other format, including the current one, so a caller can tell "needs migrating" from "not a site".
export function parseLegacyState(raw: string): LegacySiteState | null {
  const s = stateObject(raw);
  if (
    !s ||
    s.version !== LEGACY_STATE_VERSION ||
    typeof s.scriptId !== "number" ||
    !hasCommonShape(s)
  ) {
    return null;
  }
  return s as unknown as LegacySiteState;
}

export function migrateLegacyState(legacy: LegacySiteState): RemoteSiteState {
  const { scriptId, routerVersion, ...rest } = legacy;
  return { ...rest, version: STATE_VERSION };
}
