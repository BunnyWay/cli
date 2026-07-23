import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import {
  fetchStorageZone,
  fetchStorageZones,
  resolveStorageZone,
  type StorageZoneModel,
  type StorageZoneSettingsModel,
} from "./api.ts";
import { storageFileActions } from "./files.ts";
import {
  isS3Enabled,
  type S3Credentials,
  type StorageZone,
  s3Credentials,
  toStorageZone,
} from "./model.ts";
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

export interface StorageZoneUpdateResult {
  zone: StorageZone;
  /** Replication regions this update added. */
  replicationAdded: string[];
  /** Existing replication regions the input left out; they stay, because replication cannot be removed. */
  replicationKept: string[];
}

export const storageZonesUpdate = defineAction({
  name: "storage.zones.update",
  title: "Update a storage zone",
  description:
    "Update a storage zone's settings. Replication regions are merged with the ones already set, since replication cannot be removed once added.",
  schema: z.strictObject({
    zone: zoneRef,
    custom404FilePath: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Path to the file returned for missing files. Pass an empty string or null to clear it.",
      ),
    rewrite404To200: z
      .boolean()
      .optional()
      .describe("Rewrite 404 responses to 200 for extensionless URLs."),
    replicationRegions: z
      .array(z.string())
      .optional()
      .describe(
        "Region codes to replicate to. Merged with the existing set; each addition is permanent.",
      ),
  }),
  destructive: true,
  examples: [
    [
      { zone: "my-assets", custom404FilePath: "/404.html" },
      "Set the custom 404 file",
    ],
    [
      { zone: "my-assets", replicationRegions: ["LA"] },
      "Add a replication region",
    ],
  ],
  run: async (ctx, input): Promise<StorageZoneUpdateResult> => {
    ctx.progress("Resolving storage zone...");
    const target = await resolveStorageZone(ctx.clients.core, input.zone, {
      signal: ctx.signal,
    });

    const settings: StorageZoneSettingsModel = {};
    if (input.custom404FilePath !== undefined) {
      settings.Custom404FilePath = input.custom404FilePath || null;
    }
    if (input.rewrite404To200 !== undefined) {
      settings.Rewrite404To200 = input.rewrite404To200;
    }

    const existing = (target.ReplicationRegions ?? []).map((region) =>
      region.toUpperCase(),
    );
    let replicationAdded: string[] = [];
    let replicationKept: string[] = [];
    if (input.replicationRegions) {
      const requested = normalizeReplicationRegions(
        input.replicationRegions,
        target.Region ?? undefined,
      );
      replicationAdded = requested.filter(
        (region) => !existing.includes(region),
      );
      replicationKept = existing.filter(
        (region) => !requested.includes(region),
      );
      settings.ReplicationZones = [...new Set([...existing, ...requested])];
    }

    ctx.progress("Updating storage zone...");
    await ctx.clients.core.POST("/storagezone/{id}", {
      params: { path: { id: target.Id as number } },
      body: settings,
      signal: ctx.signal,
    });

    // The update endpoint returns no body, so read the zone back for the true post-state.
    ctx.progress("Fetching updated storage zone...");
    const updated = await fetchStorageZone(
      ctx.clients.core,
      target.Id as number,
      { signal: ctx.signal },
    );

    return {
      zone: toStorageZone(updated),
      replicationAdded,
      replicationKept,
    };
  },
});

export interface StorageZoneCredentials extends S3Credentials {
  zone: string;
  /** False when the zone has no S3 preview access; the keys still work for the Edge Storage API. */
  s3Enabled: boolean;
  readOnly: boolean;
}

export const storageZonesCredentials = defineAction({
  name: "storage.zones.credentials",
  title: "Get storage zone credentials",
  description:
    "Get the S3-compatible endpoint and access keys for a storage zone. The secret access key is the zone password, returned in full.",
  schema: z.strictObject({
    zone: zoneRef,
    readOnly: z
      .boolean()
      .default(false)
      .describe("Return the zone's read-only password instead of read-write."),
  }),
  destructive: false,
  sensitive: true,
  examples: [
    [{ zone: "my-assets" }, "Read-write credentials"],
    [{ zone: "my-assets", readOnly: true }, "Read-only credentials"],
  ],
  run: async (ctx, input): Promise<StorageZoneCredentials> => {
    ctx.progress("Resolving storage zone...");
    const target = await resolveStorageZone(ctx.clients.core, input.zone, {
      signal: ctx.signal,
    });

    return {
      ...s3Credentials(target, input.readOnly),
      zone: target.Name ?? "",
      s3Enabled: isS3Enabled(target),
      readOnly: input.readOnly,
    };
  },
});

export const storageActions: Action[] = [
  ...storageFileActions,
  storageRegionsList,
  storageZonesList,
  storageZonesGet,
  storageZonesCreate,
  storageZonesUpdate,
  storageZonesDelete,
  storageZonesCredentials,
];
