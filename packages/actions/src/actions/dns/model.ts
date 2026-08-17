import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { AddDnsRecordModel, DnsRecordModel, DnsZoneModel } from "./api.ts";
import type { DelegationCheck } from "./nameservers.ts";
import {
  parseRecordType,
  RECORD_TYPE_LABELS,
  RECORD_TYPES,
  recordName,
  recordTypeLabel,
} from "./record-types.ts";

export const DnsRecordSchema = z.object({
  id: z.number(),
  type: z.string().describe("Record type label, e.g. `A`, `MX`, `PZ`."),
  name: z.string().describe("Record name, `@` for the zone apex."),
  value: z.string(),
  ttl: z.number().nullable(),
  priority: z.number().optional(),
  weight: z.number().optional(),
  port: z.number().optional(),
  flags: z.number().optional(),
  tag: z.string().optional(),
  disabled: z.boolean(),
  comment: z.string().optional(),
  linkName: z
    .string()
    .optional()
    .describe("Linked resource name for PullZone/Script records."),
});

export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export function toDnsRecord(record: DnsRecordModel): DnsRecord {
  const out: DnsRecord = {
    id: record.Id ?? 0,
    type: recordTypeLabel(record.Type),
    name: recordName(record.Name),
    value: record.Value ?? "",
    ttl: record.Ttl ?? null,
    disabled: record.Disabled ?? false,
  };
  if (record.Priority != null) out.priority = record.Priority;
  if (record.Weight != null) out.weight = record.Weight;
  if (record.Port != null) out.port = record.Port;
  if (record.Flags != null) out.flags = record.Flags;
  if (record.Tag != null && record.Tag !== "") out.tag = record.Tag;
  if (record.Comment) out.comment = record.Comment;
  if (record.LinkName) out.linkName = record.LinkName;
  return out;
}

export const DelegationSchema = z.object({
  status: z
    .enum(["bunny", "other", "unknown"])
    .describe(
      "`bunny` when the domain delegates to the expected nameservers, `other` when it points elsewhere, `unknown` when resolution failed.",
    ),
  resolved: z
    .array(z.string())
    .describe("The nameservers the parent zone actually returned."),
});

export type Delegation = z.infer<typeof DelegationSchema>;

const zoneSummaryShape = {
  id: z.number(),
  domain: z.string(),
  recordCount: z.number(),
  dnssecEnabled: z.boolean(),
  loggingEnabled: z.boolean(),
  customNameserversEnabled: z.boolean(),
  nameserversDetected: z
    .boolean()
    .describe(
      "bunny's stored delegation flag. Defaults to true on a fresh zone; prefer `delegation` when present.",
    ),
  nameservers: z
    .array(z.string())
    .describe("The nameservers this zone should be delegated to."),
  soaEmail: z.string().optional(),
  dateCreated: z.string().optional(),
  dateModified: z.string().optional(),
  delegation: DelegationSchema.optional().describe(
    "Live delegation check result; only present when requested.",
  ),
};

export const DnsZoneSummarySchema = z.object(zoneSummaryShape);
export type DnsZoneSummary = z.infer<typeof DnsZoneSummarySchema>;

export const DnsZoneSchema = z.object({
  ...zoneSummaryShape,
  records: z.array(DnsRecordSchema),
});
export type DnsZone = z.infer<typeof DnsZoneSchema>;

const BUNNY_DEFAULT_NAMESERVERS = ["kiki.bunny.net", "coco.bunny.net"];

export function toDnsZoneSummary(
  zone: DnsZoneModel,
  delegation?: DelegationCheck,
): DnsZoneSummary {
  const custom = Boolean(
    zone.CustomNameserversEnabled && (zone.Nameserver1 || zone.Nameserver2),
  );
  const summary: DnsZoneSummary = {
    id: zone.Id ?? 0,
    domain: zone.Domain ?? "",
    recordCount: (zone.Records ?? []).length,
    dnssecEnabled: zone.DnsSecEnabled ?? false,
    loggingEnabled: zone.LoggingEnabled ?? false,
    customNameserversEnabled: custom,
    // Trust a conclusive live check over the stored flag, which is true on a fresh zone.
    nameserversDetected:
      delegation && delegation.status !== "unknown"
        ? delegation.status === "bunny"
        : (zone.NameserversDetected ?? false),
    nameservers: custom
      ? [zone.Nameserver1, zone.Nameserver2].filter((ns): ns is string =>
          Boolean(ns),
        )
      : BUNNY_DEFAULT_NAMESERVERS,
  };
  if (zone.SoaEmail) summary.soaEmail = zone.SoaEmail;
  if (zone.DateCreated) summary.dateCreated = zone.DateCreated;
  if (zone.DateModified) summary.dateModified = zone.DateModified;
  if (delegation) summary.delegation = delegation;
  return summary;
}

export function toDnsZone(
  zone: DnsZoneModel,
  delegation?: DelegationCheck,
): DnsZone {
  return {
    ...toDnsZoneSummary(zone, delegation),
    records: (zone.Records ?? [])
      .map(toDnsRecord)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const DnsRecordInputSchema = z.strictObject({
  type: z
    .string()
    .min(1)
    .describe(`Record type label: ${RECORD_TYPE_LABELS.join(", ")}.`),
  name: z
    .string()
    .default("@")
    .describe("Record name; `@` (the default) targets the zone apex."),
  value: z
    .string()
    .optional()
    .describe(
      "Record value: address, target host, or text. Not used by PZ/SCR records.",
    ),
  ttl: z.number().int().positive().optional().describe("TTL in seconds."),
  priority: z.number().int().optional().describe("Priority (MX and SRV)."),
  weight: z.number().int().optional().describe("Weight (SRV)."),
  port: z.number().int().optional().describe("Port (SRV)."),
  flags: z.number().int().optional().describe("Flags (CAA)."),
  tag: z
    .string()
    .optional()
    .describe("Tag (CAA): `issue`, `issuewild`, or `iodef`."),
  pullZoneId: z
    .number()
    .int()
    .optional()
    .describe("Pull zone ID (PZ records)."),
  scriptId: z
    .number()
    .int()
    .optional()
    .describe("Edge Script ID (SCR records)."),
  comment: z.string().optional().describe("Optional comment for the record."),
});

export type DnsRecordInput = z.input<typeof DnsRecordInputSchema>;
type DnsRecordInputResolved = z.infer<typeof DnsRecordInputSchema>;

/** Map a flat record input to the API body, enforcing per-type required fields. */
export function toAddRecordModel(
  input: z.infer<typeof DnsRecordInputSchema>,
): AddDnsRecordModel {
  const type = parseRecordType(input.type);
  const label = recordTypeLabel(type);
  const record: AddDnsRecordModel = {
    Type: type,
    Name: input.name === "@" ? "" : input.name,
  };

  if (type === RECORD_TYPES.PULLZONE) {
    if (input.pullZoneId == null)
      throw new UserError(`${label} records require pullZoneId.`);
    record.PullZoneId = input.pullZoneId;
  } else if (type === RECORD_TYPES.SCRIPT) {
    if (input.scriptId == null)
      throw new UserError(`${label} records require scriptId.`);
    record.ScriptId = input.scriptId;
  } else if (type === RECORD_TYPES.MX) {
    if (!input.value)
      throw new UserError("MX records require a value (the mail server).");
    record.Value = input.value;
    record.Priority = input.priority ?? 0;
  } else if (type === RECORD_TYPES.SRV) {
    if (!input.value || input.port == null)
      throw new UserError("SRV records require a value (the target) and port.");
    record.Value = input.value;
    record.Priority = input.priority ?? 0;
    record.Weight = input.weight ?? 0;
    record.Port = input.port;
  } else if (type === RECORD_TYPES.CAA) {
    if (!input.value || !input.tag)
      throw new UserError("CAA records require a value and tag.");
    record.Value = input.value;
    record.Tag = input.tag;
    record.Flags = input.flags ?? 0;
  } else {
    if (!input.value) throw new UserError(`${label} records require a value.`);
    record.Value = input.value;
  }

  if (input.ttl !== undefined) record.Ttl = input.ttl;
  if (input.comment !== undefined) record.Comment = input.comment;
  return record;
}

/** Map an API record body back to the flat input shape (scan results, import previews). */
export function fromAddRecordModel(
  record: AddDnsRecordModel,
): DnsRecordInputResolved {
  const out: DnsRecordInputResolved = {
    type: recordTypeLabel(record.Type as number),
    name: recordName(record.Name),
  };
  if (record.Value) out.value = record.Value;
  if (record.Ttl != null) out.ttl = record.Ttl;
  if (record.Priority != null) out.priority = record.Priority;
  if (record.Weight != null) out.weight = record.Weight;
  if (record.Port != null) out.port = record.Port;
  if (record.Flags != null) out.flags = record.Flags;
  if (record.Tag != null && record.Tag !== "") out.tag = record.Tag;
  if (record.PullZoneId != null) out.pullZoneId = record.PullZoneId;
  if (record.ScriptId != null) out.scriptId = record.ScriptId;
  if (record.Comment) out.comment = record.Comment;
  return out;
}
