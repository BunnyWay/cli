import type { components } from "@bunny.net/openapi-client/core";
import { z } from "zod";

export type PullZoneModel = components["schemas"]["PullZoneModel"];

/** Stable view of a pull zone. */
export const PullZoneSchema = z.object({
  id: z.number(),
  name: z.string(),
  originUrl: z.string().nullable(),
  status: z.enum(["active", "disabled", "suspended"]),
  hostnames: z.array(z.string()),
  storageZoneId: z.number().nullable(),
  edgeScriptId: z.number().nullable(),
  zoneSecurity: z.boolean(),
});

export type PullZone = z.infer<typeof PullZoneSchema>;

export function toPullZone(zone: PullZoneModel): PullZone {
  return {
    id: zone.Id ?? 0,
    name: zone.Name ?? "",
    originUrl: zone.OriginUrl || null,
    status: zone.Suspended ? "suspended" : zone.Enabled ? "active" : "disabled",
    hostnames: (zone.Hostnames ?? []).flatMap((h) =>
      h.Value ? [h.Value] : [],
    ),
    storageZoneId: zone.StorageZoneId || null,
    edgeScriptId: zone.EdgeScriptId || null,
    zoneSecurity: zone.ZoneSecurityEnabled ?? false,
  };
}
