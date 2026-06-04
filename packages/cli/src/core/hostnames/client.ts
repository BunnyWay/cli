import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type Hostname = components["schemas"]["HostnameModel"];

/** A resolved pull zone plus a core client, returned by a resource's resolver. */
export interface ResolvedPullZone {
  pullZoneId: number;
  coreClient: CoreClient;
}

/** Build a URL from a hostname, respecting an existing scheme; else derive it from SSL state. */
export function hostnameUrl(
  host: string,
  opts?: { hasCertificate?: boolean | null; forceSSL?: boolean | null },
): string {
  if (/^https?:\/\//i.test(host)) return host;
  const secure = opts?.hasCertificate ?? opts?.forceSSL ?? false;
  return `${secure ? "https" : "http"}://${host}`;
}

/** Fetch a pull zone's hostnames from the core API, sorted system-first then by value. */
export async function fetchPullZoneHostnames(
  client: CoreClient,
  pullZoneId: number,
): Promise<Hostname[]> {
  const { data } = await client.GET("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
  });
  return (data?.Hostnames ?? []).sort((a, b) => {
    if (a.IsSystemHostname !== b.IsSystemHostname) {
      return a.IsSystemHostname ? -1 : 1;
    }
    return (a.Value ?? "").localeCompare(b.Value ?? "");
  });
}

/** Issue a free SSL certificate for a hostname, optionally forcing HTTPS. */
export async function enableSsl(
  client: CoreClient,
  pullZoneId: number,
  hostname: string,
  forceSSL: boolean,
): Promise<void> {
  await client.GET("/pullzone/loadFreeCertificate", {
    params: { query: { hostname } },
  });
  if (forceSSL) {
    await client.POST("/pullzone/{id}/setForceSSL", {
      params: { path: { id: pullZoneId } },
      body: { Hostname: hostname, ForceSSL: true },
    });
  }
}
