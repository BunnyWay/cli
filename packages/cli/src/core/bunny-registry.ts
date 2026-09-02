import { createCoreClient } from "@bunny.net/openapi-client";
import type { ResolvedConfig } from "@/config/index.ts";
import { clientOptions } from "./client-options.ts";
import { UserError } from "./errors.ts";

/** Endpoint and auth resolution for the bunny.net OCI registry, shared by the registry commands and apps deploy. */

/** Env var overriding the OCI registry endpoint — a stub until `/registries` returns the bunny registry (host included) directly. */
export const REGISTRY_URL_ENV = "BUNNYNET_REGISTRY_URL";

/** Default registry endpoint, used when the env var is unset. */
export const DEFAULT_REGISTRY_URL = "registry.bunny.net";

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
 * Resolve the registry endpoint: the `BUNNYNET_REGISTRY_URL` env var when
 * set, otherwise the default `registry.bunny.net`.
 */
export function resolveRegistryEndpoint(): RegistryEndpoint {
  const raw = process.env[REGISTRY_URL_ENV]?.trim();
  return parseRegistryUrl(raw || DEFAULT_REGISTRY_URL);
}

/**
 * Fetch the account id that namespaces repositories on the registry.
 * The registry stores every repository as `<accountId>/<name>`; the CLI
 * adds/strips this prefix so users only ever see the bare name.
 */
export async function fetchRegistryNamespace(
  config: ResolvedConfig,
  verbose?: boolean,
): Promise<string> {
  const client = createCoreClient(clientOptions(config, verbose));
  const { data, error } = await client.GET("/user");
  if (error || !data?.AccountId) {
    throw new UserError(
      "Could not resolve the registry namespace.",
      'Your API key may be invalid or expired. Run "bunny login" to re-authenticate.',
    );
  }
  return data.AccountId.toLowerCase();
}

/**
 * Prefix a repository name with the account namespace, unless the user
 * already included it. Pure so it's testable without API access.
 */
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

/** Build the HTTP Basic auth header from the resolved API token. */
export function basicAuthHeader(apiKey: string): string {
  const encoded = Buffer.from(`${REGISTRY_USERNAME}:${apiKey}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
}
