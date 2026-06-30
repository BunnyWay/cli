import {
  type createCoreClient,
  type DnsDiscoveredRecord,
  type DnsRecordScanJob,
  DnsRecordScanStatus,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "../../core/errors.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type DnsZoneModel = components["schemas"]["DnsZoneModel"];
export type DnsRecordModel = components["schemas"]["DnsRecordModel"];
export type { DnsDiscoveredRecord } from "@bunny.net/openapi-client";

/**
 * Trigger bunny's server-side scan for a zone's pre-existing records and poll
 * until it finishes, returning the discovered records. Throws on scan failure
 * or timeout.
 */
export async function scanZoneRecords(
  client: CoreClient,
  zoneId: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<DnsDiscoveredRecord[]> {
  const { timeoutMs = 45000, intervalMs = 1500 } = opts;
  // Remember the prior job so a fresh result is identifiable even if the trigger omits a JobId.
  let priorJobId: string | undefined;
  try {
    const { data } = await client.GET("/dnszone/{zoneId}/records/scan", {
      params: { path: { zoneId } },
    });
    priorJobId = (data as DnsRecordScanJob | undefined)?.JobId ?? undefined;
  } catch {}

  const { data: trigger } = await client.POST("/dnszone/records/scan", {
    body: { ZoneId: zoneId },
  });
  const jobId = trigger?.JobId;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data: raw } = await client.GET("/dnszone/{zoneId}/records/scan", {
      params: { path: { zoneId } },
    });
    // The generated Records type is lossy (drops Flags/Tag); read the corrected shape.
    const data = raw as DnsRecordScanJob | undefined;
    // Match the triggered job by id; without one, accept only a job that differs from the prior result.
    const isOurJob = jobId
      ? data?.JobId === jobId
      : data?.JobId != null && data.JobId !== priorJobId;
    if (data && isOurJob) {
      if (data.Status === DnsRecordScanStatus.Completed)
        return data.Records ?? [];
      if (data.Status === DnsRecordScanStatus.Failed) {
        throw new UserError(
          `DNS record scan failed for zone ${zoneId}.`,
          data.Error ?? undefined,
        );
      }
    }
    if (Date.now() > deadline) {
      throw new UserError(
        "Timed out waiting for the DNS record scan to finish.",
        'Try again, or import records manually with "bunny dns records import".',
      );
    }
    await Bun.sleep(intervalMs);
  }
}

/** Fetch all DNS zones on the account, paginated and sorted by domain. */
export async function fetchZones(client: CoreClient): Promise<DnsZoneModel[]> {
  const zones: DnsZoneModel[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/dnszone", {
      params: { query: { page, perPage: 1000 } },
    });
    zones.push(...(data?.Items ?? []));
    if (!data?.HasMoreItems) break;
    page++;
  }
  return zones.sort((a, b) => (a.Domain ?? "").localeCompare(b.Domain ?? ""));
}

/** Fetch a single DNS zone (including its records) by ID. */
export async function fetchZone(
  client: CoreClient,
  id: number,
): Promise<DnsZoneModel> {
  const { data } = await client.GET("/dnszone/{id}", {
    params: { path: { id } },
  });
  if (!data) throw new UserError(`DNS zone ${id} not found.`);
  return data;
}

/**
 * Resolve a zone reference (numeric ID or domain name) to a full zone.
 *
 * Numeric input is treated as a zone ID; anything else is matched against
 * the account's zones by domain name.
 */
export async function resolveZone(
  client: CoreClient,
  domainOrId: string,
): Promise<DnsZoneModel> {
  const ref = domainOrId.trim();
  if (!ref) throw new UserError("A domain or zone ID is required.");

  if (/^\d+$/.test(ref)) return fetchZone(client, Number(ref));

  const { data } = await client.GET("/dnszone", {
    params: { query: { search: ref, perPage: 1000 } },
  });
  const match = (data?.Items ?? []).find(
    (z) => (z.Domain ?? "").toLowerCase() === ref.toLowerCase(),
  );
  if (!match?.Id) {
    throw new UserError(
      `No DNS zone found for "${domainOrId}".`,
      'Run "bunny dns zones list" to see your zones.',
    );
  }
  return fetchZone(client, match.Id);
}
