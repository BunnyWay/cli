import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";

export type DnsRecordTypes = components["schemas"]["DnsRecordTypes"];

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
