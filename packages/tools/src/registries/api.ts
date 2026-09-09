import { ApiError, UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/magic-containers";
import type { McClient } from "../context.ts";

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
  try {
    const { data } = await client.GET("/registries/{registryId}", {
      params: { path: { registryId } },
      signal: opts.signal,
    });

    if (data) return data;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }

  const listed = await fetchRegistries(client, opts);
  const match = listed.find((registry) => registry.id === registryId);

  if (!match) throw new UserError(`Registry ${registryId} not found.`);

  return match;
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
  // `ghcr.io.example.com` is not read as ghcr.io.
  const host = server
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/:].*$/, "");
  if (!host) return undefined;
  if (host === "ghcr.io") return "gitHub";
  if (host === "docker.io" || host === "registry-1.docker.io") {
    return "dockerHub";
  }
  return undefined;
}
