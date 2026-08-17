import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import {
  discoverImportableRecords,
  resolveZone,
  type UpdateDnsRecordModel,
  writeRecords,
} from "./api.ts";
import {
  type DnsRecord,
  DnsRecordInputSchema,
  DnsRecordSchema,
  fromAddRecordModel,
  toAddRecordModel,
  toDnsRecord,
} from "./model.ts";
import { parseRecordType } from "./record-types.ts";

const zoneRef = z
  .string()
  .min(1)
  .describe("Zone domain or numeric ID, e.g. `example.com` or `12345`.");

const recordId = z.number().int().describe("Record ID within the zone.");

export const dnsRecordsList = defineAction({
  name: "dns.records.list",
  title: "List DNS records",
  description:
    "List every record in a DNS zone, sorted by name, with type-specific fields (priority, weight, port, flags, tag) where they apply.",
  schema: z.strictObject({ zone: zoneRef }),
  kind: "read",
  resultSchema: z.array(DnsRecordSchema),
  examples: [[{ zone: "example.com" }, "List a zone's records"]],
  run: async (ctx, { zone }): Promise<DnsRecord[]> => {
    ctx.progress("Fetching records...");
    const resolved = await resolveZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });
    return (resolved.Records ?? [])
      .map(toDnsRecord)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const CreatedDnsRecordSchema = DnsRecordSchema.extend({
  zoneId: z.number(),
  domain: z.string(),
});

export type CreatedDnsRecord = z.infer<typeof CreatedDnsRecordSchema>;

export const dnsRecordsCreate = defineAction({
  name: "dns.records.create",
  title: "Create a DNS record",
  description:
    "Add one record to a DNS zone. MX needs value and priority, SRV needs value and port, CAA needs value and tag, PZ needs pullZoneId, SCR needs scriptId; every other type needs just a value.",
  schema: z.strictObject({
    zone: zoneRef,
    ...DnsRecordInputSchema.shape,
  }),
  kind: "write",
  resultSchema: CreatedDnsRecordSchema,
  examples: [
    [
      { zone: "example.com", type: "A", name: "api", value: "198.51.100.1" },
      "Add an A record",
    ],
    [
      {
        zone: "example.com",
        type: "MX",
        value: "mail.example.com",
        priority: 10,
      },
      "Add an MX record at the apex",
    ],
  ],
  run: async (ctx, { zone, ...input }): Promise<CreatedDnsRecord> => {
    const body = toAddRecordModel(input);

    ctx.progress("Resolving zone...");
    const resolved = await resolveZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });

    ctx.progress("Adding record...");
    const { data } = await ctx.clients.core.PUT("/dnszone/{zoneId}/records", {
      params: { path: { zoneId: resolved.Id as number } },
      body,
      signal: ctx.signal,
    });

    return {
      ...toDnsRecord({ ...body, ...data } as Parameters<typeof toDnsRecord>[0]),
      zoneId: resolved.Id ?? 0,
      domain: resolved.Domain ?? "",
    };
  },
});

const updateFields = z.strictObject({
  type: z.string().min(1).optional().describe("New record type label."),
  name: z
    .string()
    .optional()
    .describe("New record name; `@` targets the zone apex."),
  value: z.string().optional().describe("New record value."),
  ttl: z.number().int().positive().optional(),
  priority: z.number().int().optional(),
  weight: z.number().int().optional(),
  port: z.number().int().optional(),
  flags: z.number().int().optional(),
  tag: z.string().optional(),
  comment: z.string().optional(),
  disabled: z.boolean().optional(),
  pullZoneId: z.number().int().optional(),
  scriptId: z.number().int().optional(),
});

export const dnsRecordsUpdate = defineAction({
  name: "dns.records.update",
  title: "Update a DNS record",
  description:
    "Change fields on an existing DNS record. Unspecified fields keep their current values, including advanced settings like smart routing and geolocation.",
  schema: z.strictObject({
    zone: zoneRef,
    record: recordId,
    changes: updateFields.describe("The fields to change."),
  }),
  kind: "write",
  resultSchema: CreatedDnsRecordSchema,
  examples: [
    [
      { zone: "example.com", record: 123, changes: { value: "198.51.100.2" } },
      "Change a record's value",
    ],
    [
      { zone: "example.com", record: 123, changes: { disabled: true } },
      "Disable a record",
    ],
  ],
  run: async (ctx, { zone, record, changes }): Promise<CreatedDnsRecord> => {
    ctx.progress("Fetching record...");
    const resolved = await resolveZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });
    const existing = (resolved.Records ?? []).find((r) => r.Id === record);
    if (!existing) {
      throw new UserError(
        `Record ${record} not found in ${resolved.Domain}.`,
        "List record IDs with dns.records.list.",
      );
    }

    // Seed from the existing record so unspecified fields (including advanced settings) are preserved.
    const body: UpdateDnsRecordModel = {
      Type: existing.Type ?? null,
      Ttl: existing.Ttl ?? null,
      Value: existing.Value ?? null,
      Name: existing.Name ?? null,
      Weight: existing.Weight ?? null,
      Priority: existing.Priority ?? null,
      Flags: existing.Flags ?? null,
      Tag: existing.Tag ?? null,
      Port: existing.Port ?? null,
      Disabled: existing.Disabled ?? null,
      Comment: existing.Comment ?? null,
      Accelerated: existing.Accelerated ?? null,
      MonitorType: existing.MonitorType ?? null,
      GeolocationLatitude: existing.GeolocationLatitude ?? null,
      GeolocationLongitude: existing.GeolocationLongitude ?? null,
      LatencyZone: existing.LatencyZone ?? null,
      SmartRoutingType: existing.SmartRoutingType ?? null,
      EnviromentalVariables: existing.EnviromentalVariables ?? null,
      AutoSslIssuance: existing.AutoSslIssuance ?? null,
    };

    // AcceleratedPullZoneId is the CDN-acceleration pull zone, not a PullZone-type record's link; only seed it when actually accelerated.
    if (existing.Accelerated && existing.AcceleratedPullZoneId != null) {
      body.PullZoneId = existing.AcceleratedPullZoneId;
    }

    if (changes.type !== undefined) body.Type = parseRecordType(changes.type);
    if (changes.name !== undefined)
      body.Name = changes.name === "@" ? "" : changes.name;
    if (changes.value !== undefined) body.Value = changes.value;
    if (changes.ttl !== undefined) body.Ttl = changes.ttl;
    if (changes.priority !== undefined) body.Priority = changes.priority;
    if (changes.weight !== undefined) body.Weight = changes.weight;
    if (changes.port !== undefined) body.Port = changes.port;
    if (changes.flags !== undefined) body.Flags = changes.flags;
    if (changes.tag !== undefined) body.Tag = changes.tag;
    if (changes.comment !== undefined) body.Comment = changes.comment;
    if (changes.disabled !== undefined) body.Disabled = changes.disabled;
    if (changes.pullZoneId !== undefined) body.PullZoneId = changes.pullZoneId;
    if (changes.scriptId !== undefined) body.ScriptId = changes.scriptId;

    ctx.progress("Updating record...");
    await ctx.clients.core.POST("/dnszone/{zoneId}/records/{id}", {
      params: { path: { zoneId: resolved.Id as number, id: record } },
      body,
      signal: ctx.signal,
    });

    return {
      ...toDnsRecord({
        ...existing,
        ...body,
        Id: record,
      } as Parameters<typeof toDnsRecord>[0]),
      zoneId: resolved.Id ?? 0,
      domain: resolved.Domain ?? "",
    };
  },
});

export const DeletedDnsRecordSchema = z.object({
  zoneId: z.number(),
  domain: z.string(),
  id: z.number(),
  type: z.string(),
  name: z.string(),
  deleted: z.literal(true),
});

export type DeletedDnsRecord = z.infer<typeof DeletedDnsRecordSchema>;

export const dnsRecordsDelete = defineAction({
  name: "dns.records.delete",
  title: "Delete a DNS record",
  description:
    "Delete one record from a DNS zone by ID. The name stops resolving once caches expire. This cannot be undone.",
  schema: z.strictObject({ zone: zoneRef, record: recordId }),
  kind: "destructive",
  resultSchema: DeletedDnsRecordSchema,
  examples: [[{ zone: "example.com", record: 123 }, "Delete a record"]],
  run: async (ctx, { zone, record }): Promise<DeletedDnsRecord> => {
    ctx.progress("Fetching record...");
    const resolved = await resolveZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });
    const existing = (resolved.Records ?? []).find((r) => r.Id === record);
    if (!existing) {
      throw new UserError(
        `Record ${record} not found in ${resolved.Domain}.`,
        "List record IDs with dns.records.list.",
      );
    }

    ctx.progress("Deleting record...");
    await ctx.clients.core.DELETE("/dnszone/{zoneId}/records/{id}", {
      params: { path: { zoneId: resolved.Id as number, id: record } },
      signal: ctx.signal,
    });

    const normalized = toDnsRecord(existing);
    return {
      zoneId: resolved.Id ?? 0,
      domain: resolved.Domain ?? "",
      id: record,
      type: normalized.type,
      name: normalized.name,
      deleted: true,
    };
  },
});

export const dnsRecordsScan = defineAction({
  name: "dns.records.scan",
  title: "Scan for existing DNS records",
  description:
    "Scan a domain's current DNS host for records that exist there but not yet in the bunny.net zone, and return them in the shape dns.records.import accepts. Nothing is written.",
  schema: z.strictObject({ zone: zoneRef }),
  kind: "read",
  resultSchema: z.array(DnsRecordInputSchema),
  examples: [
    [{ zone: "example.com" }, "Discover records to migrate from the old host"],
  ],
  run: async (ctx, { zone }) => {
    ctx.progress("Resolving zone...");
    const resolved = await resolveZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });
    ctx.progress("Scanning for existing DNS records...");
    const discovered = await discoverImportableRecords(
      ctx.clients.core,
      resolved,
      { signal: ctx.signal },
    );
    return discovered.map(fromAddRecordModel);
  },
});

export const ImportedDnsRecordsSchema = z.object({
  zoneId: z.number(),
  domain: z.string(),
  applied: z.array(DnsRecordInputSchema),
  failures: z.array(
    z.object({ record: DnsRecordInputSchema, error: z.string() }),
  ),
});

export type ImportedDnsRecords = z.infer<typeof ImportedDnsRecordsSchema>;

export const dnsRecordsImport = defineAction({
  name: "dns.records.import",
  title: "Import DNS records",
  description:
    "Write a batch of records to a DNS zone, one at a time. A failed record never aborts the rest; the result lists every applied record and every failure. Throws only when nothing could be written.",
  schema: z.strictObject({
    zone: zoneRef,
    records: z
      .array(DnsRecordInputSchema)
      .min(1)
      .describe("The records to write, e.g. the result of dns.records.scan."),
  }),
  kind: "write",
  resultSchema: ImportedDnsRecordsSchema,
  examples: [
    [
      {
        zone: "example.com",
        records: [{ type: "A", name: "api", value: "198.51.100.1" }],
      },
      "Import one record",
    ],
  ],
  run: async (ctx, { zone, records }): Promise<ImportedDnsRecords> => {
    const bodies = records.map(toAddRecordModel);

    ctx.progress("Resolving zone...");
    const resolved = await resolveZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });

    ctx.progress(`Importing ${bodies.length} record(s)...`);
    const { applied, failures } = await writeRecords(
      ctx.clients.core,
      resolved,
      bodies,
      { signal: ctx.signal },
    );

    if (applied.length === 0 && failures.length > 0) {
      throw new UserError(
        `None of the ${failures.length} record(s) could be added to ${resolved.Domain}.`,
        failures[0]?.message,
      );
    }

    return {
      zoneId: resolved.Id ?? 0,
      domain: resolved.Domain ?? "",
      applied: applied.map(fromAddRecordModel),
      failures: failures.map((f) => ({
        record: fromAddRecordModel(f.record),
        error: f.message,
      })),
    };
  },
});

export const dnsRecordActions: Action[] = [
  dnsRecordsList,
  dnsRecordsCreate,
  dnsRecordsUpdate,
  dnsRecordsDelete,
  dnsRecordsScan,
  dnsRecordsImport,
];
