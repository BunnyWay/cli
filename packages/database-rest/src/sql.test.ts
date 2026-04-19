import { describe, expect, test } from "bun:test";
import type { ParsedQuery } from "./parser.ts";
import {
  buildCountQuery,
  buildDeleteQuery,
  buildInsertQuery,
  buildSelectQuery,
  buildUpdateQuery,
} from "./sql.ts";

describe("buildSelectQuery", () => {
  test("builds simple select all", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe('SELECT * FROM "users"');
    expect(result.args).toEqual([]);
  });

  test("builds select with specific columns", () => {
    const query: ParsedQuery = {
      select: ["id", "name", "email"],
      filters: [],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe('SELECT "id", "name", "email" FROM "users"');
  });

  test("builds select with filters", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [
        { column: "status", operator: "eq", value: "active" },
        { column: "age", operator: "gte", value: 18 },
      ],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe(
      'SELECT * FROM "users" WHERE "status" = ? AND "age" >= ?',
    );
    expect(result.args).toEqual(["active", 18]);
  });

  test("builds select with order", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [],
      order: [
        { column: "name", direction: "asc", nullsFirst: false },
        { column: "id", direction: "desc", nullsFirst: false },
      ],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe(
      'SELECT * FROM "users" ORDER BY "name" ASC, "id" DESC',
    );
  });

  test("builds select with nulls first", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [],
      order: [{ column: "name", direction: "asc", nullsFirst: true }],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe(
      'SELECT * FROM "users" ORDER BY "name" ASC NULLS FIRST',
    );
  });

  test("builds select with limit and offset", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [],
      order: [],
      limit: 10,
      offset: 20,
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe('SELECT * FROM "users" LIMIT 10 OFFSET 20');
  });

  test("builds select with IS NULL filter", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [{ column: "deleted_at", operator: "is", value: null }],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NULL');
    expect(result.args).toEqual([]);
  });

  test("builds select with IN filter", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [{ column: "role", operator: "in", value: ["admin", "mod"] }],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe('SELECT * FROM "users" WHERE "role" IN (?, ?)');
    expect(result.args).toEqual(["admin", "mod"]);
  });

  test("builds select with LIKE filter", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [{ column: "name", operator: "like", value: "%John%" }],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe('SELECT * FROM "users" WHERE "name" LIKE ?');
    expect(result.args).toEqual(["%John%"]);
  });

  test("builds select with ILIKE filter", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [{ column: "name", operator: "ilike", value: "%john%" }],
      order: [],
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe(
      'SELECT * FROM "users" WHERE "name" LIKE ? COLLATE NOCASE',
    );
  });

  test("escapes table names with quotes", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [],
      order: [],
    };

    const result = buildSelectQuery("user table", query);
    expect(result.sql).toBe('SELECT * FROM "user table"');
  });

  test("builds full query with all clauses", () => {
    const query: ParsedQuery = {
      select: ["id", "name"],
      filters: [{ column: "active", operator: "eq", value: 1 }],
      order: [{ column: "name", direction: "asc", nullsFirst: false }],
      limit: 10,
      offset: 5,
    };

    const result = buildSelectQuery("users", query);
    expect(result.sql).toBe(
      'SELECT "id", "name" FROM "users" WHERE "active" = ? ORDER BY "name" ASC LIMIT 10 OFFSET 5',
    );
    expect(result.args).toEqual([1]);
  });
});

describe("buildCountQuery", () => {
  test("builds simple count", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [],
      order: [],
    };

    const result = buildCountQuery("users", query);
    expect(result.sql).toBe('SELECT COUNT(*) as count FROM "users"');
  });

  test("builds count with filters", () => {
    const query: ParsedQuery = {
      select: [],
      filters: [{ column: "active", operator: "eq", value: true }],
      order: [],
    };

    const result = buildCountQuery("users", query);
    expect(result.sql).toBe(
      'SELECT COUNT(*) as count FROM "users" WHERE "active" = ?',
    );
    expect(result.args).toEqual([true]);
  });
});

describe("buildInsertQuery", () => {
  test("builds insert with returning", () => {
    const result = buildInsertQuery("users", {
      name: "John",
      email: "john@example.com",
    });

    expect(result.sql).toBe(
      'INSERT INTO "users" ("name", "email") VALUES (?, ?) RETURNING *',
    );
    expect(result.args).toEqual(["John", "john@example.com"]);
  });

  test("handles null values", () => {
    const result = buildInsertQuery("users", { name: "John", bio: null });

    expect(result.sql).toBe(
      'INSERT INTO "users" ("name", "bio") VALUES (?, ?) RETURNING *',
    );
    expect(result.args).toEqual(["John", null]);
  });
});

describe("buildUpdateQuery", () => {
  test("builds update with filter", () => {
    const result = buildUpdateQuery("users", { name: "Jane" }, [
      { column: "id", operator: "eq", value: 1 },
    ]);

    expect(result.sql).toBe(
      'UPDATE "users" SET "name" = ? WHERE "id" = ? RETURNING *',
    );
    expect(result.args).toEqual(["Jane", 1]);
  });

  test("builds update with multiple fields and filters", () => {
    const result = buildUpdateQuery(
      "users",
      { name: "Jane", email: "jane@example.com" },
      [
        { column: "id", operator: "eq", value: 1 },
        { column: "active", operator: "eq", value: true },
      ],
    );

    expect(result.sql).toBe(
      'UPDATE "users" SET "name" = ?, "email" = ? WHERE "id" = ? AND "active" = ? RETURNING *',
    );
    expect(result.args).toEqual(["Jane", "jane@example.com", 1, true]);
  });
});

describe("buildDeleteQuery", () => {
  test("builds delete with filter", () => {
    const result = buildDeleteQuery("users", [
      { column: "id", operator: "eq", value: 1 },
    ]);

    expect(result.sql).toBe('DELETE FROM "users" WHERE "id" = ? RETURNING *');
    expect(result.args).toEqual([1]);
  });

  test("builds delete with multiple filters", () => {
    const result = buildDeleteQuery("users", [
      { column: "status", operator: "eq", value: "deleted" },
      { column: "age", operator: "lt", value: 18 },
    ]);

    expect(result.sql).toBe(
      'DELETE FROM "users" WHERE "status" = ? AND "age" < ? RETURNING *',
    );
    expect(result.args).toEqual(["deleted", 18]);
  });
});
