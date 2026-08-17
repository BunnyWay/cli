import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import { fetchZones, resolveZone } from "./api.ts";
import {
  type DnsZone,
  DnsZoneSchema,
  type DnsZoneSummary,
  DnsZoneSummarySchema,
  toDnsZone,
  toDnsZoneSummary,
} from "./model.ts";
import { checkDelegations, expectedNameservers } from "./nameservers.ts";

const zoneRef = z
  .string()
  .min(1)
  .describe("Zone domain or numeric ID, e.g. `example.com` or `12345`.");

export const dnsZonesList = defineAction({
  name: "dns.zones.list",
  title: "List DNS zones",
  description:
    "List every DNS zone on the account with record counts and nameserver settings. Optionally resolve each domain's live delegation to see whether it actually points at bunny.net.",
  schema: z.strictObject({
    search: z
      .string()
      .min(1)
      .optional()
      .describe("Only return zones whose domain matches this term."),
    checkDelegation: z
      .boolean()
      .default(false)
      .describe(
        "Resolve each domain's parent-zone NS delegation live. Slower, but authoritative.",
      ),
  }),
  kind: "read",
  resultSchema: z.array(DnsZoneSummarySchema),
  examples: [
    [{}, "List all zones"],
    [{ checkDelegation: true }, "List zones with live delegation status"],
  ],
  run: async (ctx, input): Promise<DnsZoneSummary[]> => {
    ctx.progress("Fetching DNS zones...");
    let zones = await fetchZones(ctx.clients.core, { signal: ctx.signal });
    const term = input.search?.trim().toLowerCase();
    if (term) {
      zones = zones.filter((z) =>
        (z.Domain ?? "").toLowerCase().includes(term),
      );
    }
    if (!input.checkDelegation || zones.length === 0) {
      return zones.map((zone) => toDnsZoneSummary(zone));
    }

    ctx.progress("Checking nameserver delegation...");
    const checks = await checkDelegations(
      zones.map((zone) => ({
        domain: zone.Domain ?? "",
        expected: expectedNameservers(zone),
      })),
    );
    return zones.map((zone, i) => toDnsZoneSummary(zone, checks[i]));
  },
});

export const dnsZonesGet = defineAction({
  name: "dns.zones.get",
  title: "Get a DNS zone",
  description:
    "Get one DNS zone by domain or ID, including every record and the zone's nameserver, DNSSEC, and logging settings.",
  schema: z.strictObject({ zone: zoneRef }),
  kind: "read",
  resultSchema: DnsZoneSchema,
  examples: [[{ zone: "example.com" }, "Look a zone up by domain"]],
  run: async (ctx, { zone }): Promise<DnsZone> => {
    ctx.progress("Fetching zone...");
    return toDnsZone(
      await resolveZone(ctx.clients.core, zone, {
        signal: ctx.signal,
      }),
    );
  },
});

export const dnsZonesCreate = defineAction({
  name: "dns.zones.create",
  title: "Create a DNS zone",
  description:
    "Create a DNS zone for a domain. The domain must then be delegated to the zone's nameservers at the registrar before records resolve.",
  schema: z.strictObject({
    domain: z
      .string()
      .min(1)
      .describe("The domain to create a zone for, e.g. `example.com`."),
  }),
  kind: "write",
  resultSchema: DnsZoneSchema,
  examples: [[{ domain: "example.com" }, "Create a zone"]],
  run: async (ctx, { domain }): Promise<DnsZone> => {
    ctx.progress("Creating DNS zone...");
    // The create response carries no body; look the zone up by domain afterwards.
    await ctx.clients.core.POST("/dnszone", {
      body: { Domain: domain },
      signal: ctx.signal,
    });
    return toDnsZone(
      await resolveZone(ctx.clients.core, domain, { signal: ctx.signal }),
    );
  },
});

export const DeletedDnsZoneSchema = z.object({
  id: z.number(),
  domain: z.string(),
  recordCount: z
    .number()
    .describe("How many records were deleted along with the zone."),
  deleted: z.literal(true),
});

export type DeletedDnsZone = z.infer<typeof DeletedDnsZoneSchema>;

export const dnsZonesDelete = defineAction({
  name: "dns.zones.delete",
  title: "Delete a DNS zone",
  description:
    "Delete a DNS zone and every record in it. The domain stops resolving through bunny.net immediately. This cannot be undone.",
  schema: z.strictObject({ zone: zoneRef }),
  kind: "destructive",
  resultSchema: DeletedDnsZoneSchema,
  examples: [[{ zone: "example.com" }, "Delete a zone"]],
  run: async (ctx, input): Promise<DeletedDnsZone> => {
    ctx.progress("Fetching zone...");
    const zone = await resolveZone(ctx.clients.core, input.zone, {
      signal: ctx.signal,
    });

    ctx.progress("Deleting zone...");
    await ctx.clients.core.DELETE("/dnszone/{id}", {
      params: { path: { id: zone.Id as number } },
      signal: ctx.signal,
    });

    return {
      id: zone.Id ?? 0,
      domain: zone.Domain ?? "",
      recordCount: (zone.Records ?? []).length,
      deleted: true,
    };
  },
});

export const dnsZoneActions: Action[] = [
  dnsZonesList,
  dnsZonesGet,
  dnsZonesCreate,
  dnsZonesDelete,
];
