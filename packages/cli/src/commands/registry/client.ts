import {
  basicAuthHeader,
  type RegistryEndpoint,
} from "@/core/bunny-registry.ts";
import { UserError } from "@/core/errors.ts";

export {
  fetchRegistryNamespace,
  parseRegistryUrl,
  qualifyRepository,
  REGISTRY_USERNAME,
  type RegistryEndpoint,
  resolveRegistryEndpoint,
  stripNamespace,
} from "@/core/bunny-registry.ts";

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
