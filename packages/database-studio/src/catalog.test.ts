import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { sqliteClient } from "@bunny.net/database-adapter/sqlite";
import type { Database } from "@bunny.net/database-client";
import { loadCatalog } from "./catalog.ts";

test("a view over a dropped table doesn't stop the catalog loading", async () => {
  const db = new Sqlite(":memory:");
  db.exec(`
    CREATE TABLE a (x INTEGER);
    CREATE TABLE b (y INTEGER);
    CREATE VIEW stale AS SELECT x FROM a;
    CREATE VIEW fine AS SELECT y FROM b;
    DROP TABLE a;
  `);
  const client = sqliteClient(db) as unknown as Pick<Database, "prepare">;

  const { views, ddl } = await loadCatalog(client, new Set(["b"]));

  expect(views.map((v) => [v.name, v.columns])).toEqual([
    ["fine", ["y"]],
    ["stale", []],
  ]);
  expect(ddl.b).toEqual(["CREATE TABLE b (y INTEGER)"]);
});
