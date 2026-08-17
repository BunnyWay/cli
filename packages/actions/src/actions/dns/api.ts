import {
  type DnsDiscoveredRecord,
  type DnsRecordScanJob,
  DnsRecordScanStatus,
  UserError,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import type { CoreClient } from "../../context.ts";
import { RECORD_TYPES } from "./record-types.ts";

export type DnsZoneModel = components["schemas"]["DnsZoneModel"];
export type DnsRecordModel = components["schemas"]["DnsRecordModel"];
export type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];
export type UpdateDnsRecordModel =
  components["schemas"]["UpdateDnsRecordModel"];
export type { DnsDiscoveredRecord } from "@bunny.net/openapi-client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trigger bunny's server-side scan for a zone's pre-existing records and poll
 * until it finishes, returning the discovered records. Throws on scan failure
 * or timeout.
 */
export async function scanZoneRecords(
  client: CoreClient,
  zoneId: number,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<DnsDiscoveredRecord[]> {
  const { timeoutMs = 45000, intervalMs = 1500 } = opts;
  // Remember the prior job so a fresh result is identifiable even if the trigger omits a JobId.
  let priorJobId: string | undefined;
  try {
    const { data } = await client.GET("/dnszone/{zoneId}/records/scan", {
      params: { path: { zoneId } },
      signal: opts.signal,
    });
    priorJobId = (data as DnsRecordScanJob | undefined)?.JobId ?? undefined;
  } catch {}

  const { data: trigger } = await client.POST("/dnszone/records/scan", {
    body: { ZoneId: zoneId },
    signal: opts.signal,
  });
  const jobId = trigger?.JobId;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data: raw } = await client.GET("/dnszone/{zoneId}/records/scan", {
      params: { path: { zoneId } },
      signal: opts.signal,
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
    await sleep(intervalMs);
  }
}

/** Fetch all DNS zones on the account, paginated and sorted by domain. */
export async function fetchZones(
  client: CoreClient,
  opts: { signal?: AbortSignal } = {},
): Promise<DnsZoneModel[]> {
  const zones: DnsZoneModel[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/dnszone", {
      params: { query: { page, perPage: 1000 } },
      signal: opts.signal,
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
  opts: { signal?: AbortSignal } = {},
): Promise<DnsZoneModel> {
  const { data } = await client.GET("/dnszone/{id}", {
    params: { path: { id } },
    signal: opts.signal,
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
  opts: { signal?: AbortSignal } = {},
): Promise<DnsZoneModel> {
  const ref = domainOrId.trim();
  if (!ref) throw new UserError("A domain or zone ID is required.");

  if (/^\d+$/.test(ref)) return fetchZone(client, Number(ref), opts);

  const { data } = await client.GET("/dnszone", {
    params: { query: { search: ref, perPage: 1000 } },
    signal: opts.signal,
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
  return fetchZone(client, match.Id, opts);
}

export interface RecordWriteFailure {
  record: AddDnsRecordModel;
  message: string;
}
export interface WriteRecordsResult {
  applied: AddDnsRecordModel[];
  failures: RecordWriteFailure[];
}

/**
 * Write records one at a time, recording each outcome. A failed record never
 * aborts the rest: callers get every success and every failure so one bad
 * record can't strand a migration half-applied.
 */
export async function writeRecords(
  client: CoreClient,
  zone: DnsZoneModel,
  records: AddDnsRecordModel[],
  opts: { signal?: AbortSignal } = {},
): Promise<WriteRecordsResult> {
  const applied: AddDnsRecordModel[] = [];
  const failures: RecordWriteFailure[] = [];
  for (const record of records) {
    try {
      await client.PUT("/dnszone/{zoneId}/records", {
        params: { path: { zoneId: zone.Id as number } },
        body: record,
        signal: opts.signal,
      });
      applied.push(record);
    } catch (err) {
      failures.push({
        record,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { applied, failures };
}

const SOA_TYPE = 16;

// Fallback for a CAA whose flags/tag weren't broken out: split the rdata ("0 issue letsencrypt.org").
const CAA_RDATA = /^\s*(\d{1,3})\s+([A-Za-z0-9]+)\s+"?(.*?)"?\s*$/;
function caaFields(
  value: string,
): Pick<AddDnsRecordModel, "Flags" | "Tag" | "Value"> | null {
  const match = value.match(CAA_RDATA);
  if (!match) return null;
  const [, flags = "0", tag = "issue", caaValue = ""] = match;
  return { Flags: Number(flags), Tag: tag.toLowerCase(), Value: caaValue };
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").replace(/^@$/, "").toLowerCase().replace(/\.$/, "");
}

/** The zone manages its own apex SOA and apex NS delegation; subdomain NS are real child delegations. */
function isZoneManaged(type: number, name: string): boolean {
  if (type === SOA_TYPE) return true;
  return type === RECORD_TYPES.NS && normalizeName(name) === "";
}

/** A comparable key so an already-present record isn't offered again. */
function recordKey(r: {
  Type?: number | null;
  Name?: string | null;
  Value?: string | null;
  Priority?: number | null;
  Weight?: number | null;
  Port?: number | null;
  Flags?: number | null;
  Tag?: string | null;
}): string {
  const name = normalizeName(r.Name);
  const value = (r.Value ?? "").trim().toLowerCase().replace(/\.$/, "");
  // Type-specific fields keep otherwise-identical MX/SRV/CAA records distinct.
  const extra = [
    r.Priority ?? "",
    r.Weight ?? "",
    r.Port ?? "",
    r.Flags ?? "",
    (r.Tag ?? "").toLowerCase(),
  ].join(":");
  return `${r.Type ?? ""}|${name}|${value}|${extra}`;
}

/** Scan a zone for pre-existing records and return the ones worth importing. */
export async function discoverImportableRecords(
  client: CoreClient,
  zone: DnsZoneModel,
  opts: { signal?: AbortSignal } = {},
): Promise<AddDnsRecordModel[]> {
  const discovered = await scanZoneRecords(client, zone.Id as number, opts);
  const existing = new Set((zone.Records ?? []).map(recordKey));
  const out: AddDnsRecordModel[] = [];
  for (const d of discovered) {
    const name = d.Name === "@" ? "" : (d.Name ?? "");
    if (d.Type == null || isZoneManaged(d.Type, name)) continue;
    const record: AddDnsRecordModel = {
      Type: d.Type as components["schemas"]["DnsRecordTypes"],
      Name: name,
      Value: d.Value ?? "",
      Ttl: d.Ttl ?? undefined,
      Priority: d.Priority ?? undefined,
      Weight: d.Weight ?? undefined,
      Port: d.Port ?? undefined,
      Flags: d.Flags ?? undefined,
      Tag: d.Tag ?? undefined,
    };
    // The scan carries Flags/Tag for CAA; only reconstruct from the rdata when it didn't.
    if (
      record.Type === RECORD_TYPES.CAA &&
      record.Tag == null &&
      record.Value
    ) {
      const caa = caaFields(record.Value);
      if (caa) Object.assign(record, caa);
    }
    if (existing.has(recordKey(record))) continue;
    out.push(record);
  }
  return out;
}
