import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";

export type ContainerEndpoint = components["schemas"]["ContainerEndpoint"];
type Application = components["schemas"]["Application"];

/** One reachable endpoint, flattened across the app's containers. */
export interface DeployedEndpointLine {
  container: string;
  name: string;
  type: string;
  /**
   * Where the endpoint is reachable: an `https://`/`http://` URL for
   * `cdn` endpoints, an IP for `anycast`/`publicIp`. `undefined` while
   * the target is still being provisioned (see {@link endpointTarget}).
   */
  target?: string;
}

/**
 * Resolve the address a user would actually hit for a deployed endpoint.
 *
 * - `cdn` endpoints are reached over their CDN hostname → an
 *   `https://` / `http://` URL built from `publicHost` + `isSslEnabled`.
 * - `anycast` / `publicIp` endpoints are reached by IP → the first
 *   assigned public IP address.
 *
 * Returns `undefined` when there's no reachable target yet — e.g. an
 * anycast endpoint whose public IPs are still being assigned in the
 * seconds after a deploy. Callers render that as "provisioning…".
 */
export function endpointTarget(
  endpoint: ContainerEndpoint,
): string | undefined {
  if (endpoint.type === "cdn") {
    if (!endpoint.publicHost) return undefined;
    const scheme = endpoint.isSslEnabled ? "https" : "http";
    return `${scheme}://${endpoint.publicHost}`;
  }
  // anycast / publicIp are reached directly by IP.
  return endpoint.publicIpAddresses?.[0]?.address || undefined;
}

/**
 * Flatten every container's endpoints into a single list, resolving each
 * to its reachable URL/IP. Used to surface "where is my app now?" at the
 * end of a deploy without making the caller walk the nested template
 * shape.
 */
export function collectDeployedEndpoints(
  app: Application | undefined,
): DeployedEndpointLine[] {
  const lines: DeployedEndpointLine[] = [];
  for (const ct of app?.containerTemplates ?? []) {
    for (const ep of ct.endpoints ?? []) {
      lines.push({
        container: ct.name,
        name: ep.displayName,
        type: ep.type,
        target: endpointTarget(ep),
      });
    }
  }
  return lines;
}
