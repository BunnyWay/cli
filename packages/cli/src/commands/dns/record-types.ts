import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "../../core/errors.ts";

export type DnsRecordTypes = components["schemas"]["DnsRecordTypes"];
export type DnsRecordModel = components["schemas"]["DnsRecordModel"];

/** Record type name → bunny.net integer enum value. */
export const RECORD_TYPES = {
  A: 0,
  AAAA: 1,
  CNAME: 2,
  TXT: 3,
  MX: 4,
  REDIRECT: 5,
  FLATTEN: 6,
  PULLZONE: 7,
  SRV: 8,
  CAA: 9,
  PTR: 10,
  SCRIPT: 11,
  NS: 12,
  SVCB: 13,
  HTTPS: 14,
  TLSA: 15,
} as const satisfies Record<string, DnsRecordTypes>;

const TYPE_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(RECORD_TYPES).map(([name, value]) => [value, name]),
);

/** Human label for a record type integer, falling back to "UNKNOWN". */
export function recordTypeLabel(type: number | null | undefined): string {
  return TYPE_LABELS[type ?? -1] ?? "UNKNOWN";
}

/** Parse a record type name (e.g. "A", "cname") to its enum value, or throw. */
export function parseRecordType(value: string): DnsRecordTypes {
  const key = value.trim().toUpperCase() as keyof typeof RECORD_TYPES;
  const parsed = RECORD_TYPES[key];
  if (parsed === undefined) {
    throw new UserError(
      `Unknown record type "${value}".`,
      `Valid types: ${Object.keys(RECORD_TYPES).join(", ")}`,
    );
  }
  return parsed;
}

/** Display the record name, showing "@" for the zone apex. */
export function recordName(name: string | null | undefined): string {
  return name && name.length > 0 ? name : "@";
}

/** Render a record's value for display, including type-specific fields. */
export function formatRecordValue(record: DnsRecordModel): string {
  const value = record.Value ?? "";
  switch (record.Type) {
    case RECORD_TYPES.MX:
      return `${record.Priority ?? 0} ${value}`;
    case RECORD_TYPES.SRV:
      return `${record.Priority ?? 0} ${record.Weight ?? 0} ${record.Port ?? 0} ${value}`;
    case RECORD_TYPES.CAA:
      return `${record.Flags ?? 0} ${record.Tag ?? ""} "${value}"`;
    default:
      return value;
  }
}
