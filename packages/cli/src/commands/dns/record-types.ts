import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import {
  type DnsRecordTypes,
  RECORD_TYPE_LABELS,
  RECORD_TYPE_META,
  RECORD_TYPES,
  recordTypeFromLabel,
  recordTypeLabel,
} from "../../core/dns-record-types.ts";
import { UserError } from "../../core/errors.ts";

export { type DnsRecordTypes, RECORD_TYPE_META, RECORD_TYPES, recordTypeLabel };
export type DnsRecordModel = components["schemas"]["DnsRecordModel"];

export const CAA_TAGS = ["issue", "issuewild", "iodef"] as const;

/** Parse a record type label (e.g. "A", "cname", "PZ") to its enum value, or throw. */
export function parseRecordType(value: string): DnsRecordTypes {
  const parsed = recordTypeFromLabel(value);
  if (parsed === undefined) {
    throw new UserError(
      `Unknown record type "${value}".`,
      `Valid types: ${RECORD_TYPE_LABELS.join(", ")}`,
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
