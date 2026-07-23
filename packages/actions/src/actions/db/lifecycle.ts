import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import { fetchDatabase, fetchRegionConfig, regionNameMap } from "./api.ts";
import { type Database, toDatabase } from "./model.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];

/** Maximum length the backend accepts for a database name. */
export const DB_NAME_MAX_LENGTH = 16;

const databaseRef = z
  .string()
  .min(1)
  .describe("Database ID, e.g. `db_01KCHBG8C5KSFGG0VRNFQ7EK7X`.");

export const dbCreate = defineAction({
  name: "db.create",
  title: "Create a database",
  description:
    "Create a database in the given primary regions, optionally replicated to others. When storageRegion is omitted it is derived from the first primary region.",
  schema: z.strictObject({
    name: z
      .string()
      .min(1)
      .max(
        DB_NAME_MAX_LENGTH,
        `Database name must be ${DB_NAME_MAX_LENGTH} characters or fewer.`,
      )
      .describe("Name for the new database."),
    primaryRegions: z
      .array(z.string().min(1))
      .min(1)
      .describe('Primary region codes, e.g. `["FR", "DE"]`.'),
    replicaRegions: z
      .array(z.string().min(1))
      .default([])
      .describe("Replica region codes."),
    storageRegion: z
      .string()
      .optional()
      .describe(
        "Storage region code. Derived from the first primary region when omitted.",
      ),
  }),
  destructive: true,
  examples: [
    [{ name: "my-app", primaryRegions: ["FR"] }, "A single-region database"],
    [
      { name: "my-app", primaryRegions: ["FR"], replicaRegions: ["UK"] },
      "A replicated database",
    ],
  ],
  run: async (ctx, input): Promise<Database> => {
    let storageRegion = input.storageRegion;
    if (!storageRegion) {
      ctx.progress("Resolving storage region...");
      const config = await fetchRegionConfig(ctx.clients.db, {
        signal: ctx.signal,
      });
      const firstPrimary = config.primary_regions.find(
        (region) => region.id === input.primaryRegions[0],
      );
      // Prefer a storage region in the same continent as the primary; fall back to the first.
      storageRegion =
        config.storage_region_available.find(
          (region) => region.group === firstPrimary?.group,
        )?.id ??
        config.storage_region_available[0]?.id ??
        "";
    }

    ctx.progress("Creating database...");
    const { data } = await ctx.clients.db.POST("/v2/databases", {
      body: {
        name: input.name,
        storage_region: storageRegion as PossibleRegion,
        primary_regions: input.primaryRegions as PossibleRegion[],
        replicas_regions: input.replicaRegions as PossibleRegion[],
      },
      signal: ctx.signal,
    });

    if (!data?.db_id) throw new UserError("Failed to create database.");

    ctx.progress("Fetching database details...");
    const [db, config] = await Promise.all([
      fetchDatabase(ctx.clients.db, data.db_id, { signal: ctx.signal }),
      fetchRegionConfig(ctx.clients.db, { signal: ctx.signal }),
    ]);
    return toDatabase(db, undefined, regionNameMap(config));
  },
});

export interface DeletedDatabase {
  id: string;
  name: string;
  /** The connection URL of the deleted database, so a caller can clean up matching .env entries. */
  url: string;
  deleted: true;
}

export const dbDelete = defineAction({
  name: "db.delete",
  title: "Delete a database",
  description:
    "Permanently delete a database, including all data, tokens, and configuration. This cannot be undone.",
  schema: z.strictObject({ database: databaseRef }),
  destructive: true,
  examples: [[{ database: "db_01KCH" }, "Delete a database"]],
  run: async (ctx, input): Promise<DeletedDatabase> => {
    ctx.progress("Fetching database...");
    const db = await fetchDatabase(ctx.clients.db, input.database, {
      signal: ctx.signal,
    });

    ctx.progress("Deleting database...");
    await ctx.clients.db.DELETE("/v2/databases/{db_id}", {
      params: { path: { db_id: input.database } },
      signal: ctx.signal,
    });

    return { id: db.id, name: db.name, url: db.url, deleted: true };
  },
});

export interface DatabaseUsage {
  database: string;
  name: string;
  from: string;
  to: string;
  rowsRead: number;
  rowsWritten: number;
  queries: number;
  avgLatencyMs: number;
  storage: {
    bytes: number;
    maxBytes: number;
    percent: number;
  };
}

/** Sum a chart's [timestamp, value] datapoints. */
function sumDatapoints(data: (string | number)[][]): number {
  return data.reduce((total, point) => total + (Number(point[1]) || 0), 0);
}

export const dbUsage = defineAction({
  name: "db.usage",
  title: "Get database usage",
  description:
    "Get rows read/written, query count, average latency, and storage utilisation for a database over a time range (defaults to the last 30 days).",
  schema: z.strictObject({
    database: databaseRef,
    from: z
      .string()
      .optional()
      .describe("Start of the range as an RFC 3339 timestamp."),
    to: z
      .string()
      .optional()
      .describe("End of the range as an RFC 3339 timestamp. Defaults to now."),
  }),
  destructive: false,
  examples: [[{ database: "db_01KCH" }, "Usage for the last 30 days"]],
  run: async (ctx, input): Promise<DatabaseUsage> => {
    const now = Date.now();
    const to = input.to ?? new Date(now).toISOString();
    const from =
      input.from ?? new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    ctx.progress("Fetching usage data...");
    const [statsResult, db] = await Promise.all([
      ctx.clients.db.GET("/v2/databases/{db_id}/statistics", {
        params: {
          path: { db_id: input.database },
          query: { from, to },
        },
        signal: ctx.signal,
      }),
      fetchDatabase(ctx.clients.db, input.database, { signal: ctx.signal }),
    ]);

    const stats = statsResult.data;
    if (!stats) throw new UserError("Could not fetch usage statistics.");

    const latencyPoints = Object.values(stats.latency.data)
      .flatMap((region) => region.data)
      .filter((point) => Number(point[1]) > 0);
    const avgLatency = latencyPoints.length
      ? latencyPoints.reduce((sum, point) => sum + Number(point[1]), 0) /
        latencyPoints.length
      : 0;

    const maxBytes = db.size_max_bytes;
    return {
      database: input.database,
      name: db.name,
      from,
      to,
      rowsRead: sumDatapoints(stats.row_read_count.data),
      rowsWritten: sumDatapoints(stats.row_write_count.data),
      queries: sumDatapoints(stats.query_count.data),
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      storage: {
        bytes: db.current_size_bytes,
        maxBytes,
        percent:
          maxBytes > 0
            ? Math.round((db.current_size_bytes / maxBytes) * 100)
            : 0,
      },
    };
  },
});

export const dbLifecycleActions: Action[] = [dbCreate, dbDelete, dbUsage];
