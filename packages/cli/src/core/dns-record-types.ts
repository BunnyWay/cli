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

export type RecordTypeGroup = "Standard" | "Bunny";

interface RecordTypeMeta {
  value: DnsRecordTypes;
  /** Short label shown in tables (matches the bunny dashboard). */
  label: string;
  /** Friendlier name shown in pickers. */
  name: string;
  group: RecordTypeGroup;
}

/** Per-type metadata mirroring the bunny dashboard taxonomy (Standard first, then Bunny). */
export const RECORD_TYPE_META: RecordTypeMeta[] = [
  { value: RECORD_TYPES.A, label: "A", name: "A", group: "Standard" },
  { value: RECORD_TYPES.AAAA, label: "AAAA", name: "AAAA", group: "Standard" },
  {
    value: RECORD_TYPES.CNAME,
    label: "CNAME",
    name: "CNAME",
    group: "Standard",
  },
  { value: RECORD_TYPES.TXT, label: "TXT", name: "TXT", group: "Standard" },
  { value: RECORD_TYPES.MX, label: "MX", name: "MX", group: "Standard" },
  { value: RECORD_TYPES.SRV, label: "SRV", name: "SRV", group: "Standard" },
  { value: RECORD_TYPES.CAA, label: "CAA", name: "CAA", group: "Standard" },
  { value: RECORD_TYPES.PTR, label: "PTR", name: "PTR", group: "Standard" },
  { value: RECORD_TYPES.NS, label: "NS", name: "NS", group: "Standard" },
  { value: RECORD_TYPES.SVCB, label: "SVCB", name: "SVCB", group: "Standard" },
  {
    value: RECORD_TYPES.HTTPS,
    label: "HTTPS",
    name: "HTTPS",
    group: "Standard",
  },
  { value: RECORD_TYPES.TLSA, label: "TLSA", name: "TLSA", group: "Standard" },
  {
    value: RECORD_TYPES.PULLZONE,
    label: "PZ",
    name: "Pull Zone (PZ)",
    group: "Bunny",
  },
  {
    value: RECORD_TYPES.REDIRECT,
    label: "RDR",
    name: "Redirect (RDR)",
    group: "Bunny",
  },
  {
    value: RECORD_TYPES.SCRIPT,
    label: "SCR",
    name: "Script (SCR)",
    group: "Bunny",
  },
  {
    value: RECORD_TYPES.FLATTEN,
    label: "Flatten",
    name: "Flatten",
    group: "Bunny",
  },
];

const LABEL_BY_VALUE = new Map<number, string>(
  RECORD_TYPE_META.map((m) => [m.value, m.label]),
);

/** Human label for a record type integer, falling back to "UNKNOWN". */
export function recordTypeLabel(type: number | null | undefined): string {
  return LABEL_BY_VALUE.get(type ?? -1) ?? "UNKNOWN";
}

// Resolve from the canonical label (PZ, RDR, SCR, ...) or the spelled-out enum key (PULLZONE, ...).
const VALUE_BY_LABEL = new Map<string, DnsRecordTypes>();
for (const m of RECORD_TYPE_META)
  VALUE_BY_LABEL.set(m.label.toUpperCase(), m.value);
for (const [name, value] of Object.entries(RECORD_TYPES))
  VALUE_BY_LABEL.set(name, value as DnsRecordTypes);

/** Resolve a type label or enum-key name to its value, or undefined when unknown. */
export function recordTypeFromLabel(label: string): DnsRecordTypes | undefined {
  return VALUE_BY_LABEL.get(label.trim().toUpperCase());
}

/** Canonical labels in display order, for "valid types" hints. */
export const RECORD_TYPE_LABELS = RECORD_TYPE_META.map((m) => m.label);
