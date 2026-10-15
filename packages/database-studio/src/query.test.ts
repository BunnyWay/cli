import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  DatabaseError,
  type RawResult,
  type SqlValue,
} from "@bunny.net/database-client";
import {
  MAX_ROWS,
  type QueryClient,
  QueryRejected,
  queryErrorMessage,
  runReadOnlyQuery,
} from "./query.ts";

let db: Sqlite;

/** Mirrors the HTTP client: a batch runs on one connection that is gone afterwards, and SQL errors arrive as DatabaseError. */
const client: QueryClient = {
  prepare: (sql: string) => ({ sql }) as never,
  batchRaw: async (statements) => {
    try {
      return statements.map((s): RawResult => {
        const query = db.query((s as unknown as { sql: string }).sql);
        return {
          columns: query.columnNames,
          rows: query.values() as SqlValue[][],
          rowsAffected: 0,
          lastInsertRowid: null,
        };
      });
    } catch (err) {
      throw new DatabaseError((err as Error).message, { code: "SQLITE_ERROR" });
    } finally {
      db.exec("PRAGMA query_only = OFF");
    }
  },
};

const count = () =>
  (db.query("SELECT count(*) AS n FROM users").get() as { n: number }).n;

beforeEach(() => {
  db = new Sqlite(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users (name) VALUES ('Alice'), ('Bob');
  `);
});

describe("runReadOnlyQuery", () => {
  test("returns positional rows, keeping duplicate column names", async () => {
    const result = await runReadOnlyQuery(
      client,
      "SELECT a.id, b.id FROM users a JOIN users b ON a.id = b.id ORDER BY a.id;",
    );

    expect(result.columns).toEqual(["id", "id"]);
    expect(result.rows).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(result.truncated).toBe(false);
  });

  test("finds the keyword after leading comments", async () => {
    const result = await runReadOnlyQuery(
      client,
      "-- who's there\n/* all of them */ SELECT name FROM users ORDER BY id",
    );
    expect(result.rows).toEqual([["Alice"], ["Bob"]]);
  });

  test("rejects a write statement before it reaches the database", async () => {
    const run = runReadOnlyQuery(client, "DELETE FROM users");

    await expect(run).rejects.toBeInstanceOf(QueryRejected);
    expect(count()).toBe(2);
  });

  test("SQLite refuses a write hidden behind an allowed keyword", async () => {
    const err = await runReadOnlyQuery(
      client,
      "WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)",
    ).catch((e) => e);

    expect(queryErrorMessage(err)).toBe(
      "Studio is read-only, so SQLite refused a statement that writes.",
    );
    expect(count()).toBe(2);
  });

  test("caps the rows it returns and says so", async () => {
    const result = await runReadOnlyQuery(
      client,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_ROWS + 5}) SELECT i FROM n`,
    );

    expect(result.rows).toHaveLength(MAX_ROWS);
    expect(result.truncated).toBe(true);
  });
});

describe("queryErrorMessage", () => {
  test("shows SQL errors, which are about the person's own query", async () => {
    const err = await runReadOnlyQuery(client, "SELECT nope FROM users").catch(
      (e) => e,
    );
    expect(queryErrorMessage(err)).toContain("no such column");
  });

  test("keeps transport and unknown errors out of the browser", () => {
    expect(
      queryErrorMessage(new DatabaseError("401 from host", { status: 401 })),
    ).toBeNull();
    expect(queryErrorMessage(new Error("boom"))).toBeNull();
  });
});
