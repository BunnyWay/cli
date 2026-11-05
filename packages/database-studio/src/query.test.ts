import { beforeEach, describe, expect, test } from "bun:test";
import { DatabaseError, type SqlValue } from "@bunny.net/database-client";
import {
  MAX_ROWS,
  pragmaAsSelect,
  type QueryClient,
  QueryRejected,
  queryErrorMessage,
  rejectionReason,
  runReadOnlyQuery,
} from "./query.ts";

let sent: string[];
let reply: { columns: string[]; rows: SqlValue[][] };

const client: QueryClient = {
  prepare: (sql: string) =>
    ({
      runRaw: async () => {
        sent.push(sql);
        return { ...reply, rowsAffected: 0, lastInsertRowid: null };
      },
    }) as never,
};

beforeEach(() => {
  sent = [];
  reply = { columns: [], rows: [] };
});

describe("runReadOnlyQuery", () => {
  test("returns positional rows, keeping duplicate column names", async () => {
    reply = { columns: ["id", "id"], rows: [[1, 1]] };
    const result = await runReadOnlyQuery(
      client,
      "SELECT a.id, b.id FROM users a JOIN users b ON a.id = b.id",
    );

    expect(result).toMatchObject({ ...reply, truncated: false });
  });

  test("sends only the statement itself, nothing libSQL would reject", async () => {
    await runReadOnlyQuery(client, "SELECT 1");
    expect(sent).toEqual(["SELECT 1"]);
  });

  test("runs read-only PRAGMAs in their SELECT form, which a read-only token allows", async () => {
    await runReadOnlyQuery(client, "PRAGMA table_info('users')");
    expect(sent).toEqual(["SELECT * FROM pragma_table_info('users')"]);

    await runReadOnlyQuery(client, "PRAGMA user_version;");
    expect(sent[1]).toBe("SELECT * FROM pragma_user_version()");
  });

  test("rejects writes before they reach the database", async () => {
    for (const sql of [
      "DELETE FROM users",
      "WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)",
      "WITH x AS (SELECT 1) REPLACE INTO users (id, name) VALUES (1, 'x')",
    ]) {
      await expect(runReadOnlyQuery(client, sql)).rejects.toBeInstanceOf(
        QueryRejected,
      );
    }
    expect(sent).toEqual([]);
  });

  test("caps the rows it returns and says so", async () => {
    reply = {
      columns: ["i"],
      rows: Array.from({ length: MAX_ROWS + 5 }, (_, i) => [i]),
    };
    const result = await runReadOnlyQuery(client, "SELECT i FROM n");

    expect(result.rows).toHaveLength(MAX_ROWS);
    expect(result.truncated).toBe(true);
  });
});

describe("pragmaAsSelect", () => {
  test("passes the argument as a plain string and keeps the schema", () => {
    expect(pragmaAsSelect('PRAGMA table_info("my""t")')).toBe(
      `SELECT * FROM pragma_table_info('my"t')`,
    );
    expect(pragmaAsSelect('PRAGMA table_info("a(b)");')).toBe(
      "SELECT * FROM pragma_table_info('a(b)')",
    );
    expect(pragmaAsSelect("PRAGMA aux.table_info(t)")).toBe(
      "SELECT * FROM pragma_table_info('t', 'aux')",
    );
  });
});

describe("rejectionReason", () => {
  test("ignores write words inside strings, identifiers, comments, and replace()", () => {
    for (const sql of [
      "SELECT 'please delete me' AS note",
      "SELECT [drop] FROM t",
      "SELECT 1 /* insert later */",
      "SELECT replace(name, 'a', 'b') FROM users",
      "SELECT begin, release, analyze, col2delete FROM events",
    ]) {
      expect(rejectionReason(sql)).toBeNull();
    }
  });

  test("allows PRAGMAs that only read", () => {
    for (const sql of [
      "PRAGMA table_info(users)",
      "PRAGMA main.index_list('users')",
      "PRAGMA user_version",
    ]) {
      expect(rejectionReason(sql)).toBeNull();
    }
  });

  test("rejects more than one statement", () => {
    expect(rejectionReason("SELECT 1; PRAGMA user_version = 5")).not.toBeNull();
    expect(rejectionReason("SELECT ';' AS semi")).toBeNull();
  });

  test("rejects PRAGMAs that set something", () => {
    for (const sql of [
      "PRAGMA user_version = 5",
      "PRAGMA user_version(5)",
      "PRAGMA query_only = ON",
      "PRAGMA table_info = users",
    ]) {
      expect(rejectionReason(sql)).not.toBeNull();
    }
  });
});

describe("queryErrorMessage", () => {
  test("shows SQL errors, which are about the person's own query", () => {
    const err = new DatabaseError("no such column: nope", {
      code: "SQLITE_ERROR",
    });
    expect(queryErrorMessage(err)).toBe("no such column: nope");
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
