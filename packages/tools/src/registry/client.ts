import { Buffer } from "node:buffer";
import { UserError } from "@bunny.net/openapi-client";
import type { CoreClient } from "../context.ts";

/** Default OCI registry endpoint, used when the host does not override it. */
export const DEFAULT_REGISTRY_URL = "registry.bunny.net";

/** Basic-auth username for the registry. The API token is the password. */
export const REGISTRY_USERNAME = "token";

export interface RegistryEndpoint {
  /** Normalised base URL with no trailing slash (e.g. `https://host`). */
  baseUrl: string;
  /** Host[:port] used for `docker login` and image refs. */
  host: string;
}

/** Normalise a raw registry URL, defaulting the scheme to https when omitted. */
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

/** Build the HTTP Basic auth header from the resolved API token. */
export function basicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${REGISTRY_USERNAME}:${apiKey}`).toString("base64")}`;
}

/** Prefix a repository with the account namespace unless it already carries one. */
export function qualifyRepository(
  repository: string,
  namespace: string,
): string {
  const repo = repository.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!repo) throw new UserError("Repository name is empty.");
  return repo.startsWith(`${namespace}/`) ? repo : `${namespace}/${repo}`;
}

/** Strip the account namespace from a repository name for display. */
export function stripNamespace(repository: string, namespace: string): string {
  return repository.startsWith(`${namespace}/`)
    ? repository.slice(namespace.length + 1)
    : repository;
}

/**
 * The account ID that namespaces every repository on the registry.
 *
 * The registry stores repositories as `<accountId>/<name>`; callers add and
 * strip that prefix so a user only ever sees the bare name.
 */
export async function fetchNamespace(
  client: CoreClient,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const { data, error } = await client.GET("/user", { signal: opts.signal });
  if (error || !data?.AccountId) {
    throw new UserError(
      "Could not resolve the registry namespace.",
      'Your API key may be invalid or expired. Run "bunny login" to re-authenticate.',
    );
  }
  return data.AccountId.toLowerCase();
}

/** Authenticated reads against the OCI distribution API. Not an openapi-client, so it lives here. */
export interface RegistryClient {
  readonly endpoint: RegistryEndpoint;
  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T>;
}

export function createRegistryClient(options: {
  apiKey: string;
  url?: string;
  fetch?: typeof fetch;
}): RegistryClient {
  const endpoint = parseRegistryUrl(options.url || DEFAULT_REGISTRY_URL);
  const doFetch = options.fetch ?? fetch;

  return {
    endpoint,
    async get<T>(
      path: string,
      opts: { signal?: AbortSignal } = {},
    ): Promise<T> {
      const res = await doFetch(`${endpoint.baseUrl}${path}`, {
        headers: {
          Accept: "application/json",
          Authorization: basicAuthHeader(options.apiKey),
        },
        signal: opts.signal,
      });

      if (res.status === 401 || res.status === 403) {
        throw new UserError(
          "Registry authentication failed.",
          'Check that your API token is valid ("bunny whoami").',
        );
      }
      if (!res.ok) {
        throw new UserError(
          `Registry request failed (HTTP ${res.status}).`,
          (await res.text().catch(() => "")).trim() || undefined,
        );
      }
      return (await res.json()) as T;
    },
  };
}
