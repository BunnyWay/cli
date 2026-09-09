import { ApiError, UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/magic-containers";
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

/** bunny.net provides some registries to every account; they are not the account's to change. */
export function refusePlatformManaged(
  registry: ContainerRegistryModel,
  verb: string,
): void {
  if (!registry.isPlatformManaged) return;
  throw new UserError(
    `"${registry.displayName ?? registry.id}" is provided by bunny.net, so it cannot be ${verb}.`,
    "It is available to every account and needs no credentials of yours.",
  );
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

function registryHost(server: string | undefined): string {
  const withoutScheme = (server ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");

  const end = withoutScheme.search(/[/:]/);

  return end === -1 ? withoutScheme : withoutScheme.slice(0, end);
}

// ghcr.io needs type "gitHub" (the backend 500s without it); docker.io wants "dockerHub".
export function registryTypeForServer(
  server: string | undefined,
): RegistryType | undefined {
  const host = registryHost(server);
  if (!host) return undefined;
  if (host === "ghcr.io") return "gitHub";
  if (host === "docker.io" || host === "registry-1.docker.io") {
    return "dockerHub";
  }
  return undefined;
}
