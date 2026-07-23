import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import {
  fetchStorageZones,
  resolveStorageZone,
  type StorageZoneModel,
} from "./api.ts";
import { type StorageZone, toStorageZone } from "./model.ts";
import {
  normalizeReplicationRegions,
  STORAGE_REGION_CODES,
  STORAGE_REGIONS,
  type StorageRegion,
} from "./regions.ts";

const zoneRef = z
  .string()
  .min(1)
  .describe("Storage zone name or numeric ID, e.g. `my-assets` or `123456`.");

export const storageRegionsList = defineAction({
  name: "storage.regions.list",
  title: "List storage regions",
  description:
    "List the regions a storage zone can be created in. Replication uses the same set, minus the zone's main region.",
  schema: z.strictObject({}),
  destructive: false,
  run: async (): Promise<StorageRegion[]> => STORAGE_REGIONS,
});

export const storageZonesList = defineAction({
  name: "storage.zones.list",
  title: "List storage zones",
  description:
    "List every storage zone on the account, with region, file count, and bytes used.",
  schema: z.strictObject({
    search: z
      .string()
      .min(1)
      .optional()
      .describe("Only return zones whose name matches this term."),
  }),
  destructive: false,
  examples: [
    [{}, "List all storage zones"],
    [{ search: "assets" }, "Find zones with `assets` in the name"],
  ],
  run: async (ctx, { search }): Promise<StorageZone[]> => {
    ctx.progress("Fetching storage zones...");
    const zones = await fetchStorageZones(ctx.clients.core, {
      search,
      signal: ctx.signal,
    });
    return zones.map(toStorageZone);
  },
});

export const storageZonesGet = defineAction({
  name: "storage.zones.get",
  title: "Get a storage zone",
  description:
    "Get one storage zone by name or ID, including replication regions and S3 compatibility.",
  schema: z.strictObject({ zone: zoneRef }),
  destructive: false,
  examples: [[{ zone: "my-assets" }, "Look a zone up by name"]],
  run: async (ctx, { zone }): Promise<StorageZone> => {
    ctx.progress("Resolving storage zone...");
    return toStorageZone(
      await resolveStorageZone(ctx.clients.core, zone, { signal: ctx.signal }),
    );
  },
});

export const storageZonesCreate = defineAction({
  name: "storage.zones.create",
  title: "Create a storage zone",
  description:
    "Create a storage zone in a main region, optionally replicated to others. The main region cannot be changed later, and replication regions cannot be removed once added.",
  schema: z.strictObject({
    name: z.string().min(1).describe("Name for the new storage zone."),
    // Preprocessed so `de` works as well as `DE`, while the JSON Schema still lists the enum.
    region: z
      .preprocess(
        (value) =>
          typeof value === "string" ? value.trim().toUpperCase() : value,
        z.enum(STORAGE_REGION_CODES as [string, ...string[]]),
      )
      .describe("Main region code, e.g. `DE`, `NY`, `LA`, `SG`."),
    replicationRegions: z
      .array(z.string())
      .default([])
      .describe(
        "Region codes to replicate to. Each adds storage cost and cannot be removed later.",
      ),
  }),
  destructive: true,
  examples: [
    [{ name: "my-assets", region: "DE" }, "Create a zone in Falkenstein"],
    [
      { name: "my-assets", region: "NY", replicationRegions: ["LA", "SG"] },
      "Create a replicated zone",
    ],
  ],
  run: async (ctx, input): Promise<StorageZone> => {
    const region = input.region;
    const replication = normalizeReplicationRegions(
      input.replicationRegions,
      region,
    );

    ctx.progress("Creating storage zone...");
    const { data } = await ctx.clients.core.POST("/storagezone", {
      body: {
        Name: input.name,
        Region: region,
        ReplicationRegions: replication.length ? replication : null,
      },
      signal: ctx.signal,
    });
    return toStorageZone((data ?? {}) as StorageZoneModel);
  },
});

export interface DeletedStorageZone {
  id: number;
  name: string;
  deleted: true;
}

export const storageZonesDelete = defineAction({
  name: "storage.zones.delete",
  title: "Delete a storage zone",
  description:
    "Permanently delete a storage zone and every file in it. This cannot be undone.",
  schema: z.strictObject({ zone: zoneRef }),
  destructive: true,
  examples: [[{ zone: "my-assets" }, "Delete a zone and all of its files"]],
  run: async (ctx, { zone }): Promise<DeletedStorageZone> => {
    ctx.progress("Resolving storage zone...");
    const target = await resolveStorageZone(ctx.clients.core, zone, {
      signal: ctx.signal,
    });

    ctx.progress("Deleting storage zone...");
    await ctx.clients.core.DELETE("/storagezone/{id}", {
      params: { path: { id: target.Id as number } },
      signal: ctx.signal,
    });

    return { id: target.Id ?? 0, name: target.Name ?? "", deleted: true };
  },
});

export const storageActions: Action[] = [
  storageRegionsList,
  storageZonesList,
  storageZonesGet,
  storageZonesCreate,
  storageZonesDelete,
];
