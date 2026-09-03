import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "@/core/errors.ts";

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

/** Whether the pull zone reports an active certificate on exactly `hostname`; null when the check itself failed. */
export async function hostnameHasCertificate(
  client: CoreClient,
  pullZoneId: number,
  hostname: string,
): Promise<boolean | null> {
  try {
    const hostnames = await fetchPullZoneHostnames(client, pullZoneId);
    return hostnames.some(
      (h) =>
        (h.Value ?? "").toLowerCase() === hostname.toLowerCase() &&
        h.HasCertificate === true,
    );
  } catch {
    return null;
  }
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
  // The endpoint can 200 without an exact-name certificate landing (e.g. an overlapping wildcard elsewhere), so trust the zone, not the status code; a failed check (null) must not fail an issuance that likely worked.
  const certified = await hostnameHasCertificate(client, pullZoneId, hostname);
  if (certified === false) {
    throw new UserError(
      `bunny.net accepted the request, but no certificate is active on "${hostname}" yet.`,
      "Retry in a minute; if it keeps happening, check for a wildcard hostname on another pull zone that overlaps this name.",
    );
  }
  // Always set Force SSL to the requested value so --no-force-ssl can also turn it off.
  await setForceSsl(client, pullZoneId, hostname, forceSSL);
}

export type TlsProbeResult = "ok" | "bad-certificate" | "unreachable";

const TLS_PROBE_TIMEOUT_MS = 8_000;

/** Best-effort HTTPS handshake check: "ok" when the certificate verifies for `hostname`, "bad-certificate" when TLS fails (mismatched or missing cert at the edge), "unreachable" when the host can't be reached at all (DNS lag, offline). */
export async function probeTlsCertificate(
  hostname: string,
): Promise<TlsProbeResult> {
  try {
    await fetch(`https://${hostname}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(TLS_PROBE_TIMEOUT_MS),
    });
    return "ok";
  } catch (err) {
    for (let e: unknown = err; e instanceof Error; e = e.cause) {
      const text = `${(e as NodeJS.ErrnoException).code ?? ""} ${e.message}`;
      if (/cert|tls|ssl|handshake|altname|principal|verify/i.test(text)) {
        return "bad-certificate";
      }
    }
    return "unreachable";
  }
}
