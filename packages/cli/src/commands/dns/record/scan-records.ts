import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { RECORD_TYPES } from "../../../core/dns-record-types.ts";
import { type CoreClient, type DnsZoneModel, scanZoneRecords } from "../api.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];
type DnsRecordTypes = components["schemas"]["DnsRecordTypes"];

// SOA (16) and NS are managed by the zone delegation; importing them would clash with bunny.
const SOA_TYPE = 16;
const SKIP_TYPES = new Set<number>([RECORD_TYPES.NS, SOA_TYPE]);

// Fallback for a CAA whose flags/tag weren't broken out: split the rdata ("0 issue letsencrypt.org").
const CAA_RDATA = /^\s*(\d{1,3})\s+(issue|issuewild|iodef)\s+"?(.*?)"?\s*$/i;
function caaFields(
  value: string,
): Pick<AddDnsRecordModel, "Flags" | "Tag" | "Value"> | null {
  const match = value.match(CAA_RDATA);
  if (!match) return null;
  const [, flags = "0", tag = "issue", caaValue = ""] = match;
  return { Flags: Number(flags), Tag: tag.toLowerCase(), Value: caaValue };
}

/** A comparable key so an already-present record isn't offered again. */
function recordKey(r: {
  Type?: number | null;
  Name?: string | null;
  Value?: string | null;
}): string {
  const name = (r.Name ?? "")
    .replace(/^@$/, "")
    .toLowerCase()
    .replace(/\.$/, "");
  return `${r.Type ?? ""}|${name}|${r.Value ?? ""}`;
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
    if (d.Type == null || SKIP_TYPES.has(d.Type)) continue;
    const record: AddDnsRecordModel = {
      Type: d.Type as DnsRecordTypes,
      Name: d.Name === "@" ? "" : (d.Name ?? ""),
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
