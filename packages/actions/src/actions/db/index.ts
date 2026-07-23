import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import {
  fetchAllDatabases,
  fetchDatabase,
  fetchLiveStatus,
  fetchRegionConfig,
  regionNameMap,
} from "./api.ts";
import { dbLifecycleActions } from "./lifecycle.ts";
import { type Database, DatabaseSchema, toDatabase } from "./model.ts";
import { dbRegionActions } from "./regions.ts";
import { dbTokenActions } from "./tokens.ts";

export const dbList = defineAction({
  name: "db.list",
  title: "List databases",
  description:
    "List every database on the account with its status, primary region, and size.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(DatabaseSchema),
  examples: [[{}, "List all databases"]],
  run: async (ctx): Promise<Database[]> => {
    ctx.progress("Fetching databases...");
    const databases = await fetchAllDatabases(ctx.clients.db, {
      signal: ctx.signal,
    });
    if (databases.length === 0) return [];

    ctx.progress("Fetching live status...");
    const [live, config] = await Promise.all([
      fetchLiveStatus(
        ctx.clients.db,
        databases.map((db) => db.id),
        { signal: ctx.signal },
      ),
      fetchRegionConfig(ctx.clients.db, { signal: ctx.signal }),
    ]);
    const regionNames = regionNameMap(config);

    return databases
      .map((db) => toDatabase(db, live[db.id], regionNames))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const dbGet = defineAction({
  name: "db.get",
  title: "Get a database",
  description:
    "Get one database by ID, including its connection URL, live status, regions, and size.",
  schema: z.strictObject({
    database: z
      .string()
      .min(1)
      .describe("Database ID, e.g. `db_01KCHBG8C5KSFGG0VRNFQ7EK7X`."),
  }),
  kind: "read",
  resultSchema: DatabaseSchema,
  examples: [
    [{ database: "db_01KCHBG8C5KSFGG0VRNFQ7EK7X" }, "Show one database"],
  ],
  run: async (ctx, { database }): Promise<Database> => {
    ctx.progress("Fetching database...");
    const [db, live, config] = await Promise.all([
      fetchDatabase(ctx.clients.db, database, { signal: ctx.signal }),
      fetchLiveStatus(ctx.clients.db, [database], { signal: ctx.signal }),
      fetchRegionConfig(ctx.clients.db, { signal: ctx.signal }),
    ]);
    return toDatabase(db, live[database], regionNameMap(config));
  },
});

export const dbActions: Action[] = [
  dbList,
  dbGet,
  ...dbLifecycleActions,
  ...dbRegionActions,
  ...dbTokenActions,
];
