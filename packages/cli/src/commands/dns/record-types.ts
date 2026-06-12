import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import {
  type DnsRecordTypes,
  RECORD_TYPES,
  recordTypeLabel,
} from "../../core/dns-record-types.ts";
import { UserError } from "../../core/errors.ts";

// Canonical definitions live in core so other layers can share them.
export { type DnsRecordTypes, RECORD_TYPES, recordTypeLabel };
export type DnsRecordModel = components["schemas"]["DnsRecordModel"];

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
