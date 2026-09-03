import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import {
  type CoreClient,
  type DnsZoneModel,
  scanZoneRecords,
} from "@/commands/dns/api.ts";
import { RECORD_TYPES } from "@/core/dns-record-types.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];
type DnsRecordTypes = components["schemas"]["DnsRecordTypes"];

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
): Promise<AddDnsRecordModel[]> {
  const discovered = await scanZoneRecords(client, zone.Id as number);
  const existing = new Set((zone.Records ?? []).map(recordKey));
  const out: AddDnsRecordModel[] = [];
  for (const d of discovered) {
    const name = d.Name === "@" ? "" : (d.Name ?? "");
    if (d.Type == null || isZoneManaged(d.Type, name)) continue;
    const record: AddDnsRecordModel = {
      Type: d.Type as DnsRecordTypes,
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
