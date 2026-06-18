import { UserError } from "./errors.ts";

/** Endpoint and auth resolution for the bunny.net OCI registry, shared by the registry commands and apps deploy. */

/** Env var holding the OCI registry endpoint — a stub until `/registries` returns the bunny registry (host included) directly. */
export const REGISTRY_URL_ENV = "BUNNYNET_REGISTRY_URL";

/** Basic-auth username for the registry. The API token is the password. */
export const REGISTRY_USERNAME = "token";

export interface RegistryEndpoint {
  /** Normalised base URL with no trailing slash (e.g. `https://host`). */
  baseUrl: string;
  /** Host[:port] used for `docker login` / image refs. */
  host: string;
}

/**
 * Normalise a raw registry URL into a base URL and host, defaulting the
 * scheme to https when omitted. Pure so it's testable without env access.
 */
export function parseRegistryUrl(raw: string): RegistryEndpoint {
  const trimmed = raw.trim();
  if (!trimmed) throw new UserError("Registry URL is empty.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UserError(`Invalid registry URL: ${raw}`);
  }

  return { baseUrl: url.origin, host: url.host };
}

/** Resolve the endpoint from the environment, or null when unset. */
export function tryResolveRegistryEndpoint(): RegistryEndpoint | null {
  const raw = process.env[REGISTRY_URL_ENV];
  return raw ? parseRegistryUrl(raw) : null;
}

/**
 * Resolve the registry endpoint from the environment. The URL is kept out
 * of help output and config so it isn't casually discoverable; an unset
 * env var is an expected, friendly error rather than a crash.
 */
export function resolveRegistryEndpoint(): RegistryEndpoint {
  const endpoint = tryResolveRegistryEndpoint();
  if (!endpoint) {
    throw new UserError(
      "Registry endpoint is not configured.",
      `Set ${REGISTRY_URL_ENV} to the registry URL and try again.`,
    );
  }
  return endpoint;
}

/** Build the HTTP Basic auth header from the resolved API token. */
export function basicAuthHeader(apiKey: string): string {
  const encoded = Buffer.from(`${REGISTRY_USERNAME}:${apiKey}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
}
