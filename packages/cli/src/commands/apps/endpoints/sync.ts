import type { EndpointConfig } from "@bunny.net/config";
import type { components } from "@bunny.net/openapi-client/magic-containers";
import { updateLinkedConfig } from "../linked-config.ts";

type ContainerEndpoint = components["schemas"]["ContainerEndpoint"];

/** The config form of a remote endpoint, or undefined for types bunny.jsonc can't express. */
export function endpointToConfig(
  endpoint: ContainerEndpoint,
): EndpointConfig | undefined {
  const type = endpoint.type.toLowerCase();
  if (type !== "cdn" && type !== "anycast") return undefined;

  return {
    type,
    ...(endpoint.displayName !== type ? { name: endpoint.displayName } : {}),
    ...(endpoint.isSslEnabled != null ? { ssl: endpoint.isSslEnabled } : {}),
    ports: endpoint.portMappings.map((pm) => ({
      ...(pm.exposedPort != null ? { public: pm.exposedPort } : {}),
      container: pm.containerPort,
    })),
  };
}

function portKeys(endpoint: EndpointConfig): string[] {
  return (endpoint.ports ?? []).map((p) => `${p.public}:${p.container}`).sort();
}

function sameEndpoint(a: EndpointConfig, b: EndpointConfig): boolean {
  const aKeys = portKeys(a);
  const bKeys = portKeys(b);

  return (
    a.type === b.type &&
    aKeys.length === bKeys.length &&
    aKeys.every((key, i) => key === bKeys[i])
  );
}

export function addEndpointToConfig(
  appId: string,
  containerName: string,
  endpoint: EndpointConfig,
): void {
  updateLinkedConfig(appId, (config) => {
    const container = config.app.containers[containerName];
    if (!container) return false;

    const endpoints = container.endpoints ?? [];
    if (endpoints.some((ep) => sameEndpoint(ep, endpoint))) return false;

    container.endpoints = [...endpoints, endpoint];
    return true;
  });
}

export function removeEndpointFromConfig(
  appId: string,
  containerName: string,
  endpoint: EndpointConfig,
): void {
  updateLinkedConfig(appId, (config) => {
    const container = config.app.containers[containerName];
    const index =
      container?.endpoints?.findIndex((ep) => sameEndpoint(ep, endpoint)) ?? -1;
    if (!container?.endpoints || index === -1) return false;

    container.endpoints.splice(index, 1);
    if (container.endpoints.length === 0) delete container.endpoints;
    return true;
  });
}
