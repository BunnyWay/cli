/**
 * What the resources are called.
 *
 * A storage zone name and a pull zone name are globally unique, across every
 * account. So a name a developer chose cannot be used as it stands: `blog` is
 * taken, and the API answers with a 409 that explains nothing. A random suffix
 * makes the name available, and the prefix makes it obvious which command owns
 * the resource.
 */
import { UserError } from "../../../core/errors.ts";

/** Every resource this command creates carries it. */
export const RESOURCE_PREFIX = "astro-";

const SUFFIX_LENGTH = 6;

/** Name rules, and the message that explains them. */
export const APP_NAME_RULES =
  "Use 3-40 lowercase letters, digits, and dashes (no leading or trailing dash).";

// The suffix and the prefix both spend characters of the 63-char DNS label a
// `*.b-cdn.net` hostname allows, so the name itself gets what is left.
const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isValidAppName(name: string): boolean {
  return APP_NAME_RE.test(name);
}

export function requireValidAppName(name: string): string {
  if (!isValidAppName(name)) {
    throw new UserError(`"${name}" is not a usable app name.`, APP_NAME_RULES);
  }
  return name;
}

/**
 * A name derived from whatever the project calls itself.
 *
 * A scope goes, because `@acme/blog` is not a hostname. So does every character
 * a DNS label cannot hold.
 */
export function appNameFrom(raw: string): string | null {
  const name = raw
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return isValidAppName(name) ? name : null;
}

function randomSuffix(): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + SUFFIX_LENGTH)
    .padEnd(SUFFIX_LENGTH, "0");
}

/**
 * The prefix, unless the name carries it already.
 *
 * An app called `astro-ssr-demo` became `astro-astro-ssr-demo-a1b2c3`, which
 * reads like a mistake and spends six characters of a DNS label on nothing.
 */
function prefixed(appName: string): string {
  return appName.startsWith(RESOURCE_PREFIX)
    ? appName
    : `${RESOURCE_PREFIX}${appName}`;
}

/** A fresh globally-unique name for the storage zone and the pull zone. */
export function suffixedName(appName: string): string {
  return `${prefixed(appName)}-${randomSuffix()}`;
}

/** Matches every name {@link suffixedName} can produce for this app. */
export function resourcePattern(appName: string): RegExp {
  return new RegExp(`^${prefixed(appName)}-[a-z0-9]{${SUFFIX_LENGTH}}$`, "i");
}

/**
 * The Edge Script's name.
 *
 * A script name is unique per account, not globally, so it takes the zone's
 * name and stays findable on a re-run.
 */
export function scriptName(resourceName: string): string {
  return `${resourceName}-server`;
}

/** Where a deploy's client files go in the zone. */
export function deployPrefix(deployId: string): string {
  return `deploys/${deployId}`;
}
