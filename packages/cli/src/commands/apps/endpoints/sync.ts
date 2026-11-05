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
    ssl: endpoint.isSslEnabled,
    ports: endpoint.portMappings.map((pm) => ({
      public: pm.exposedPort,
      container: pm.containerPort,
    })),
  };
}

function sameEndpoint(a: EndpointConfig, b: EndpointConfig): boolean {
  const aPorts = a.ports ?? [];
  const bPorts = b.ports ?? [];

  return (
    a.type === b.type &&
    aPorts.length === bPorts.length &&
    aPorts.every(
      (p, i) =>
        p.public === bPorts[i]?.public && p.container === bPorts[i]?.container,
    )
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
