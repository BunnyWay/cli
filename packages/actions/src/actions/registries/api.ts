import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import type { McClient } from "../../context.ts";

export type ContainerRegistryModel = components["schemas"]["ContainerRegistry"];
export type RegistryType = components["schemas"]["RegistryType"];
type SaveResult = components["schemas"]["SaveContainerRegistryResult"];

export async function fetchRegistries(
  client: McClient,
  opts: { signal?: AbortSignal } = {},
): Promise<ContainerRegistryModel[]> {
  const { data } = await client.GET("/registries", { signal: opts.signal });
  return data?.items ?? [];
}

export async function fetchRegistry(
  client: McClient,
  registryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<ContainerRegistryModel> {
  const { data } = await client.GET("/registries/{registryId}", {
    params: { path: { registryId } },
    signal: opts.signal,
  });
  if (!data) throw new UserError(`Registry ${registryId} not found.`);
  return data;
}

/** Turn a non-`saved` save status into the UserError every surface renders. */
export function requireSaved(
  result: SaveResult | undefined,
  verb: string,
): asserts result is SaveResult {
  if (result?.status === "saved") return;
  throw new UserError(
    `Failed to ${verb} registry: ${result?.error ?? result?.status ?? "unknown error"}.`,
  );
}

// ghcr.io needs type "gitHub" (the backend 500s without it); docker.io wants "dockerHub".
export function registryTypeForServer(
  server: string | undefined,
): RegistryType | undefined {
  const host = server
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  if (!host) return undefined;
  if (host.startsWith("ghcr.io")) return "gitHub";
  if (host.startsWith("docker.io") || host.startsWith("registry-1.docker.io")) {
    return "dockerHub";
  }
  return undefined;
}
