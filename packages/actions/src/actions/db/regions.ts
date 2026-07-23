import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import { fetchDatabaseWithRegions, fetchRegionConfig } from "./api.ts";
import { type DatabaseRegion, DatabaseRegionSchema } from "./model.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];

const CDN_PROBE_URL = "https://bunny.net/index.html";

const databaseRef = z
  .string()
  .min(1)
  .describe("Database ID, e.g. `db_01KCHBG8C5KSFGG0VRNFQ7EK7X`.");

const regionCodes = z
  .array(z.string().min(1))
  .describe('Region codes, e.g. `["FR", "DE"]`.');

/** A region a database can be placed in, with the continent group used for grouping choices. */
export const AvailableRegionSchema = DatabaseRegionSchema.extend({
  group: z.string().nullable(),
});

export type AvailableRegion = z.infer<typeof AvailableRegionSchema>;

export const AvailableRegionsSchema = z.object({
  primary: z.array(AvailableRegionSchema),
  replica: z.array(AvailableRegionSchema),
  storage: z.array(AvailableRegionSchema),
});

export type AvailableRegions = z.infer<typeof AvailableRegionsSchema>;

function toAvailable(
  regions: { id: string; name: string; group?: string | null }[],
): AvailableRegion[] {
  return regions.map((region) => ({
    code: region.id,
    name: region.name,
    group: region.group ?? null,
  }));
}

export const dbRegionsAvailable = defineAction({
  name: "db.regions.available",
  title: "List available database regions",
  description:
    "List the regions a database can use, split into primary, replica, and storage regions.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: AvailableRegionsSchema,
  run: async (ctx): Promise<AvailableRegions> => {
    ctx.progress("Fetching available regions...");
    const config = await fetchRegionConfig(ctx.clients.db, {
      signal: ctx.signal,
    });
    return {
      primary: toAvailable(config.primary_regions),
      replica: toAvailable(config.replica_regions),
      storage: toAvailable(config.storage_region_available),
    };
  },
});

export const SuggestedRegionsSchema = z.object({
  primaryRegions: z.array(z.string()),
  replicaRegions: z.array(z.string()),
  storageRegion: z.string().nullable(),
  detected: z
    .boolean()
    .describe(
      "False when the caller's location could not be detected and defaults were used instead.",
    ),
});

export type SuggestedRegions = z.infer<typeof SuggestedRegionsSchema>;

/** Discover the CDN server token by hitting a Bunny CDN edge; identifies the closest POP. */
async function cdnServerToken(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(CDN_PROBE_URL, { method: "HEAD", signal });
    return res.headers.get("server");
  } catch {
    return null;
  }
}

export const dbRegionsSuggest = defineAction({
  name: "db.regions.suggest",
  title: "Suggest database regions",
  description:
    "Suggest region placement for a new database based on the caller's location, measured by which bunny.net edge serves them. Falls back to a default spread when the location cannot be detected.",
  schema: z.strictObject({
    single: z
      .boolean()
      .default(false)
      .describe("Suggest one region with no replication instead of a spread."),
  }),
  kind: "read",
  resultSchema: SuggestedRegionsSchema,
  examples: [
    [{}, "Suggest a replicated placement"],
    [{ single: true }, "Suggest a single region"],
  ],
  run: async (ctx, input): Promise<SuggestedRegions> => {
    ctx.progress("Detecting optimal regions...");
    const token = await cdnServerToken(ctx.signal);

    if (token) {
      if (input.single) {
        const { data } = await ctx.clients.db.GET("/v1/config/optimal_single", {
          params: { query: { cdn_server_token: token } },
          signal: ctx.signal,
        });
        if (data?.region?.id) {
          return {
            primaryRegions: [data.region.id],
            replicaRegions: [],
            storageRegion: data.storage_region?.id ?? null,
            detected: true,
          };
        }
      } else {
        const { data } = await ctx.clients.db.GET("/v1/config/optimal", {
          params: { query: { cdn_server_token: token } },
          signal: ctx.signal,
        });
        if (data?.primary_regions?.length) {
          return {
            primaryRegions: data.primary_regions.map((r) => r.id),
            replicaRegions: data.replica_regions?.map((r) => r.id) ?? [],
            storageRegion: data.storage_region?.id ?? null,
            detected: true,
          };
        }
      }
    }

    // No location signal (or an empty answer): spread across the first few of each set.
    ctx.progress("Falling back to default regions...");
    const config = await fetchRegionConfig(ctx.clients.db, {
      signal: ctx.signal,
    });
    return {
      primaryRegions: config.primary_regions.slice(0, 3).map((r) => r.id),
      replicaRegions: input.single
        ? []
        : config.replica_regions.slice(0, 3).map((r) => r.id),
      storageRegion: null,
      detected: false,
    };
  },
});

export const dbRegionsList = defineAction({
  name: "db.regions.list",
  title: "List a database's regions",
  description:
    "List the primary and replica regions a database is currently placed in.",
  schema: z.strictObject({ database: databaseRef }),
  kind: "read",
  resultSchema: z.object({
    primary: z.array(DatabaseRegionSchema),
    replica: z.array(DatabaseRegionSchema),
  }),
  run: async (
    ctx,
    input,
  ): Promise<{ primary: DatabaseRegion[]; replica: DatabaseRegion[] }> => {
    ctx.progress("Fetching database and regions...");
    const { db, config } = await fetchDatabaseWithRegions(
      ctx.clients.db,
      input.database,
      { signal: ctx.signal },
    );
    const named = (code: string) => ({
      code,
      name:
        config.primary_regions
          .concat(config.replica_regions)
          .find((region) => region.id === code)?.name ?? code,
    });
    return {
      primary: db.primary_regions.map(named),
      replica: db.replicas_regions.map(named),
    };
  },
});

export const DatabaseRegionsSchema = z.object({
  database: z.string(),
  primary: z.array(DatabaseRegionSchema),
  replica: z.array(DatabaseRegionSchema),
});

export type DatabaseRegions = z.infer<typeof DatabaseRegionsSchema>;

export const dbRegionsSet = defineAction({
  name: "db.regions.set",
  title: "Set a database's regions",
  description:
    "Replace a database's primary and replica regions with exactly this set. Adding regions replicates data to them; removing regions drops the copy held there. At least one primary region is required.",
  schema: z.strictObject({
    database: databaseRef,
    primaryRegions: regionCodes.min(1),
    replicaRegions: regionCodes.default([]),
  }),
  kind: "destructive",
  resultSchema: DatabaseRegionsSchema,
  examples: [
    [
      { database: "db_01KCH", primaryRegions: ["FR"], replicaRegions: ["UK"] },
      "Place a database in FR with a UK replica",
    ],
  ],
  run: async (ctx, input): Promise<DatabaseRegions> => {
    ctx.progress("Updating regions...");
    const { data } = await ctx.clients.db.PATCH("/v2/databases/{db_id}", {
      params: { path: { db_id: input.database } },
      body: {
        primary_regions: input.primaryRegions as PossibleRegion[],
        replicas_regions: input.replicaRegions as PossibleRegion[],
      },
      signal: ctx.signal,
    });

    const config = await fetchRegionConfig(ctx.clients.db, {
      signal: ctx.signal,
    });
    const named = (code: string) => ({
      code,
      name:
        config.primary_regions
          .concat(config.replica_regions)
          .find((region) => region.id === code)?.name ?? code,
    });
    const primary = data?.db?.primary_regions ?? input.primaryRegions;
    const replica = data?.db?.replicas_regions ?? input.replicaRegions;
    return {
      database: input.database,
      primary: primary.map(named),
      replica: replica.map(named),
    };
  },
});

/** Guard the one invariant the API does not enforce for us. */
export function requirePrimaryRegion(regions: string[]): void {
  if (regions.length === 0) {
    throw new UserError(
      "Cannot remove all primary regions.",
      "At least one primary region is required.",
    );
  }
}

export const dbRegionActions: Action[] = [
  dbRegionsAvailable,
  dbRegionsSuggest,
  dbRegionsList,
  dbRegionsSet,
];
