import { UserError } from "../../core/errors.ts";

/** Env var holding the OCI registry endpoint. Intentionally undocumented. */
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

/**
 * Resolve the registry endpoint from the environment. The URL is kept out
 * of help output and config so it isn't casually discoverable; an unset
 * env var is an expected, friendly error rather than a crash.
 */
export function resolveRegistryEndpoint(): RegistryEndpoint {
  const raw = process.env[REGISTRY_URL_ENV];
  if (!raw) {
    throw new UserError(
      "Registry endpoint is not configured.",
      `Set ${REGISTRY_URL_ENV} to the registry URL and try again.`,
    );
  }
  return parseRegistryUrl(raw);
}

/** Build the HTTP Basic auth header from the resolved API token. */
export function basicAuthHeader(apiKey: string): string {
  const encoded = Buffer.from(`${REGISTRY_USERNAME}:${apiKey}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
}

/**
 * Perform an authenticated request against an OCI distribution path
 * (e.g. `/v2/_catalog`). Maps auth failures to a friendly error and
 * returns the parsed JSON body for everything else.
 */
export async function registryRequest<T = unknown>(
  endpoint: RegistryEndpoint,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${endpoint.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: basicAuthHeader(apiKey),
      ...init?.headers,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new UserError(
      "Registry authentication failed.",
      "Check that your API token is valid (`bunny whoami`).",
    );
  }
  if (!res.ok) {
    throw new UserError(
      `Registry request failed (HTTP ${res.status}).`,
      (await res.text().catch(() => "")).trim() || undefined,
    );
  }

  return (await res.json()) as T;
}
