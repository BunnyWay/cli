import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "../errors.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type Hostname = components["schemas"]["HostnameModel"];

/** Hostname fields safe to serialize — excludes Certificate/CertificateKey private-key material. */
export type SafeHostname = Pick<
  Hostname,
  | "Id"
  | "Value"
  | "ForceSSL"
  | "IsSystemHostname"
  | "IsManagedHostname"
  | "HasCertificate"
  | "CertificateProvisionType"
  | "CertificateKeyType"
>;

/** Drop certificate/private-key material so hostnames can be safely written to logs/JSON. */
export function toSafeHostname(h: Hostname): SafeHostname {
  return {
    Id: h.Id,
    Value: h.Value,
    ForceSSL: h.ForceSSL,
    IsSystemHostname: h.IsSystemHostname,
    IsManagedHostname: h.IsManagedHostname,
    HasCertificate: h.HasCertificate,
    CertificateProvisionType: h.CertificateProvisionType,
    CertificateKeyType: h.CertificateKeyType,
  };
}

/** A resolved pull zone plus a core client, returned by a resource's resolver. */
export interface ResolvedPullZone {
  pullZoneId: number;
  coreClient: CoreClient;
}

/** Strip any scheme and trailing slash from a user-supplied hostname. */
export function normalizeHostname(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
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

/** Fetch hostnames across several pull zones in parallel, tolerating per-zone failures. */
export async function fetchHostnamesForZones(
  client: CoreClient,
  zoneIds: number[],
  onError?: (zoneId: number, err: unknown) => void,
): Promise<Hostname[]> {
  const results = await Promise.all(
    zoneIds.map(async (zoneId) => {
      try {
        return await fetchPullZoneHostnames(client, zoneId);
      } catch (err) {
        onError?.(zoneId, err);
        return [] as Hostname[];
      }
    }),
  );
  return results.flat();
}

export function systemHostname(
  hostnames:
    | Array<Pick<Hostname, "IsSystemHostname" | "Value">>
    | null
    | undefined,
): string | undefined {
  return hostnames?.find((h) => h.IsSystemHostname)?.Value ?? undefined;
}

export function liveHostnames(hostnames: Hostname[]): {
  primary?: string;
  customs: string[];
} {
  if (hostnames.length === 0) return { customs: [] };
  const primaryHost = hostnames.find((h) => h.IsSystemHostname) ?? hostnames[0];
  const toUrl = (h: Hostname) =>
    hostnameUrl(h.Value ?? "", {
      hasCertificate: h.HasCertificate,
      forceSSL: h.ForceSSL,
    });
  return {
    primary: primaryHost?.Value ? toUrl(primaryHost) : undefined,
    customs: hostnames.filter((h) => h !== primaryHost && h.Value).map(toUrl),
  };
}

// PullZoneOriginType: 2 = StorageZone.
const ORIGIN_TYPE_STORAGE_ZONE = 2;

/** Create a pull zone served from a storage zone, with delivery enabled in every geo region. */
export async function createPullZone(
  client: CoreClient,
  name: string,
  storageZoneId: number,
): Promise<components["schemas"]["PullZoneModel"]> {
  const { data } = await client.POST("/pullzone", {
    body: {
      Name: name,
      StorageZoneId: storageZoneId,
      OriginType: ORIGIN_TYPE_STORAGE_ZONE,
      EnableGeoZoneUS: true,
      EnableGeoZoneEU: true,
      EnableGeoZoneASIA: true,
      EnableGeoZoneSA: true,
      EnableGeoZoneAF: true,
    },
  });
  if (!data) throw new UserError(`Failed to create pull zone ${name}.`);
  return data;
}

/** Add a hostname to a pull zone, returning the zone's hostnames and the CNAME target to point DNS at. A hostname the zone already serves reports `alreadyAttached` instead of failing, so retries after a partial setup reach their follow-up steps. */
export async function addHostname(
  client: CoreClient,
  pullZoneId: number,
  hostname: string,
): Promise<{
  hostnames: Hostname[];
  cnameTarget?: string;
  alreadyAttached: boolean;
}> {
  let hostnames: Hostname[] | undefined;
  let alreadyAttached = false;
  try {
    await client.POST("/pullzone/{id}/addHostname", {
      params: { path: { id: pullZoneId } },
      body: { Hostname: hostname },
    });
  } catch (err) {
    // The zone decides whether a rejected duplicate counts as attached, not the error.
    const existing = await fetchPullZoneHostnames(client, pullZoneId).catch(
      () => null,
    );
    const attached = existing?.some(
      (h) => (h.Value ?? "").toLowerCase() === hostname.toLowerCase(),
    );
    if (!attached) throw err;
    alreadyAttached = true;
    hostnames = existing ?? undefined;
  }
  hostnames ??= await fetchPullZoneHostnames(client, pullZoneId);
  const cnameTarget = systemHostname(hostnames)?.replace(/^https?:\/\//i, "");
  return { hostnames, cnameTarget, alreadyAttached };
}

/** Set a hostname's Force SSL (HTTP→HTTPS redirect) state; assumes the cert is already in place. */
export async function setForceSsl(
  client: CoreClient,
  pullZoneId: number,
  hostname: string,
  forceSSL: boolean,
): Promise<void> {
  await client.POST("/pullzone/{id}/setForceSSL", {
    params: { path: { id: pullZoneId } },
    body: { Hostname: hostname, ForceSSL: forceSSL },
  });
}

/** Issue a free SSL certificate for a hostname on a pull zone, then set its Force SSL state. */
export async function enableSsl(
  client: CoreClient,
  pullZoneId: number,
  hostname: string,
  forceSSL: boolean,
  knownHostnames?: Hostname[],
): Promise<void> {
  // loadFreeCertificate is account-wide (keyed only by hostname), so confirm the
  // hostname lives on this pull zone before issuing — never touch another zone's.
  const hostnames =
    knownHostnames ?? (await fetchPullZoneHostnames(client, pullZoneId));
  const onZone = hostnames.some(
    (h) => (h.Value ?? "").toLowerCase() === hostname.toLowerCase(),
  );
  if (!onZone) {
    throw new UserError(
      `"${hostname}" is not on pull zone ${pullZoneId}.`,
      "Add it first, then request a certificate.",
    );
  }

  await client.GET("/pullzone/loadFreeCertificate", {
    params: { query: { hostname } },
  });
  // Always set Force SSL to the requested value so --no-force-ssl can also turn it off.
  await setForceSsl(client, pullZoneId, hostname, forceSSL);
}
