import { createCoreClient } from "@bunny.net/openapi-client";
import type { ResolvedConfig } from "@/config/index.ts";
import { fetchNamespace, parseRegistryUrl } from "@/tools/registry/index.ts";
import { clientOptions } from "./client-options.ts";

/** Endpoint and auth resolution for the bunny.net OCI registry, shared by the registry commands and apps deploy. */

export type { RegistryEndpoint } from "@/tools/registry/index.ts";
export {
  basicAuthHeader,
  DEFAULT_REGISTRY_URL,
  parseRegistryUrl,
  qualifyRepository,
  REGISTRY_USERNAME,
  stripNamespace,
} from "@/tools/registry/index.ts";

/** Env var overriding the OCI registry endpoint, a stub until `/registries` returns the bunny registry directly. */
export const REGISTRY_URL_ENV = "BUNNYNET_REGISTRY_URL";

/** The registry URL the host is configured for, or undefined to use the default. */
export function registryUrl(): string | undefined {
  return process.env[REGISTRY_URL_ENV]?.trim() || undefined;
}

/** Resolve the registry endpoint: `BUNNYNET_REGISTRY_URL` when set, otherwise the default. */
export function resolveRegistryEndpoint() {
  return parseRegistryUrl(registryUrl() ?? "registry.bunny.net");
}

/** Account id that namespaces repositories on the registry. */
export function fetchRegistryNamespace(
  config: ResolvedConfig,
  verbose?: boolean,
): Promise<string> {
  return fetchNamespace(createCoreClient(clientOptions(config, verbose)));
}
