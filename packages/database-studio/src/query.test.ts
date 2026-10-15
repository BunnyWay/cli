import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { DatabaseError, type SqlValue } from "@bunny.net/database-client";
import {
  MAX_ROWS,
  type QueryClient,
  QueryRejected,
  queryErrorMessage,
  rejectionReason,
  runReadOnlyQuery,
} from "./query.ts";

let db: Sqlite;
let sent: string[];

/** Mirrors the HTTP client's runRaw(), recording what reaches the database. */
const client: QueryClient = {
  prepare: (sql: string) =>
    ({
      runRaw: async () => {
        sent.push(sql);
        try {
          const query = db.query(sql);
          return {
            columns: query.columnNames,
            rows: query.values() as SqlValue[][],
            rowsAffected: 0,
            lastInsertRowid: null,
          };
        } catch (err) {
          throw new DatabaseError((err as Error).message, {
            code: "SQLITE_ERROR",
          });
        }
      },
    }) as never,
};

const count = () =>
  (db.query("SELECT count(*) AS n FROM users").get() as { n: number }).n;

beforeEach(() => {
  sent = [];
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

  test("sends only the statement itself, nothing libSQL would reject", async () => {
    await runReadOnlyQuery(client, "SELECT 1");
    expect(sent).toEqual(["SELECT 1"]);
  });

  test("runs read-only PRAGMAs in their SELECT form, which a read-only token allows", async () => {
    const result = await runReadOnlyQuery(client, "PRAGMA table_info('users')");

    expect(sent).toEqual(["SELECT * FROM pragma_table_info('users')"]);
    expect(result.rows.map((r) => r[1])).toEqual(["id", "name"]);

    await runReadOnlyQuery(client, "PRAGMA user_version;");
    expect(sent[1]).toBe("SELECT * FROM pragma_user_version()");
  });

  test("rejects writes before they reach the database", async () => {
    for (const sql of [
      "DELETE FROM users",
      "WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)",
      "-- looks harmless\nWITH x AS (SELECT 1) UPDATE users SET name = 'x'",
      "WITH x AS (SELECT 1) REPLACE INTO users (id, name) VALUES (1, 'x')",
    ]) {
      await expect(runReadOnlyQuery(client, sql)).rejects.toBeInstanceOf(
        QueryRejected,
      );
    }
    expect(sent).toEqual([]);
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

describe("rejectionReason", () => {
  test("ignores write words inside strings, identifiers, comments, and replace()", () => {
    for (const sql of [
      "SELECT 'please delete me' AS note",
      'SELECT "update" FROM t',
      "SELECT [drop] FROM t",
      "SELECT 1 /* insert later */",
      "SELECT replace(name, 'a', 'b') FROM users",
      "SELECT deleted_at, created_at FROM users",
      "-- a comment first\nSELECT 1",
    ]) {
      expect(rejectionReason(sql)).toBeNull();
    }
  });

  test("allows PRAGMAs that only read", () => {
    for (const sql of [
      "PRAGMA table_info(users)",
      "PRAGMA main.index_list('users')",
      "PRAGMA foreign_key_list(users)",
      "PRAGMA user_version",
      "PRAGMA compile_options",
    ]) {
      expect(rejectionReason(sql)).toBeNull();
    }
  });

  test("rejects PRAGMAs that set something", () => {
    for (const sql of [
      "PRAGMA user_version = 5",
      "PRAGMA user_version(5)",
      "PRAGMA query_only = ON",
      "PRAGMA writable_schema = 1",
      "PRAGMA table_info = users",
    ]) {
      expect(rejectionReason(sql)).not.toBeNull();
    }
  });
});

describe("queryErrorMessage", () => {
  test("shows SQL errors, which are about the person's own query", async () => {
    const err = await runReadOnlyQuery(client, "SELECT nope FROM users").catch(
      (e) => e,
    );
    expect(queryErrorMessage(err)).toContain("no such column");
  });

  test("explains a statement the read-only token may not run", () => {
    for (const err of [
      new DatabaseError("Forbidden", { status: 403 }),
      new DatabaseError("Not authorized to execute query", {
        code: "SQLITE_AUTH",
      }),
    ]) {
      expect(queryErrorMessage(err)).toContain("read-only");
    }
  });

  test("explains a rejected token", () => {
    expect(
      queryErrorMessage(new DatabaseError("Unauthorized", { status: 401 })),
    ).toContain("restart `bunny db studio`");
  });

  test("keeps other transport and unknown errors out of the browser", () => {
    expect(
      queryErrorMessage(new DatabaseError("upstream 502", { status: 502 })),
    ).toBeNull();
    expect(queryErrorMessage(new Error("boom"))).toBeNull();
  });
});
