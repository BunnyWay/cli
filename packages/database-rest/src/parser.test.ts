import { describe, expect, test } from "bun:test";
import {
  parseFilterValue,
  parseOrder,
  parseQueryParams,
  parseSelect,
  parseTableFromPath,
} from "./parser.ts";

describe("parseSelect", () => {
  test("returns empty array for null", () => {
    expect(parseSelect(null)).toEqual([]);
  });

  test("returns empty array for *", () => {
    expect(parseSelect("*")).toEqual([]);
  });

  test("parses comma-separated columns", () => {
    expect(parseSelect("id,name,email")).toEqual(["id", "name", "email"]);
  });

  test("trims whitespace", () => {
    expect(parseSelect(" id , name , email ")).toEqual(["id", "name", "email"]);
  });

  test("filters empty strings", () => {
    expect(parseSelect("id,,name")).toEqual(["id", "name"]);
  });
});

describe("parseFilterValue", () => {
  test("defaults to eq when no operator", () => {
    expect(parseFilterValue("id", "5")).toEqual({
      column: "id",
      operator: "eq",
      value: 5,
    });
  });

  test("parses eq operator", () => {
    expect(parseFilterValue("status", "eq.active")).toEqual({
      column: "status",
      operator: "eq",
      value: "active",
    });
  });

  test("parses neq operator", () => {
    expect(parseFilterValue("status", "neq.deleted")).toEqual({
      column: "status",
      operator: "neq",
      value: "deleted",
    });
  });

  test("parses gt with number", () => {
    expect(parseFilterValue("age", "gt.18")).toEqual({
      column: "age",
      operator: "gt",
      value: 18,
    });
  });

  test("parses gte operator", () => {
    expect(parseFilterValue("age", "gte.21")).toEqual({
      column: "age",
      operator: "gte",
      value: 21,
    });
  });

  test("parses lt operator", () => {
    expect(parseFilterValue("price", "lt.100")).toEqual({
      column: "price",
      operator: "lt",
      value: 100,
    });
  });

  test("parses lte operator", () => {
    expect(parseFilterValue("price", "lte.99.99")).toEqual({
      column: "price",
      operator: "lte",
      value: 99.99,
    });
  });

  test("parses like operator", () => {
    expect(parseFilterValue("name", "like.%John%")).toEqual({
      column: "name",
      operator: "like",
      value: "%John%",
    });
  });

  test("parses ilike operator", () => {
    expect(parseFilterValue("name", "ilike.%john%")).toEqual({
      column: "name",
      operator: "ilike",
      value: "%john%",
    });
  });

  test("parses is.null", () => {
    expect(parseFilterValue("deleted_at", "is.null")).toEqual({
      column: "deleted_at",
      operator: "is",
      value: null,
    });
  });

  test("parses is.true", () => {
    expect(parseFilterValue("active", "is.true")).toEqual({
      column: "active",
      operator: "is",
      value: true,
    });
  });

  test("parses is.false", () => {
    expect(parseFilterValue("active", "is.false")).toEqual({
      column: "active",
      operator: "is",
      value: false,
    });
  });

  test("parses in operator with values", () => {
    expect(parseFilterValue("role", "in.(admin,moderator,user)")).toEqual({
      column: "role",
      operator: "in",
      value: ["admin", "moderator", "user"],
    });
  });

  test("parses in with numeric values", () => {
    expect(parseFilterValue("id", "in.(1,2,3)")).toEqual({
      column: "id",
      operator: "in",
      value: [1, 2, 3],
    });
  });

  test("returns null for unknown operator", () => {
    expect(parseFilterValue("id", "xyz.5")).toBeNull();
  });
});

describe("parseOrder", () => {
  test("returns empty array for null", () => {
    expect(parseOrder(null)).toEqual([]);
  });

  test("parses single ascending order", () => {
    expect(parseOrder("name.asc")).toEqual([
      { column: "name", direction: "asc", nullsFirst: false },
    ]);
  });

  test("parses single descending order", () => {
    expect(parseOrder("created_at.desc")).toEqual([
      { column: "created_at", direction: "desc", nullsFirst: false },
    ]);
  });

  test("defaults to asc", () => {
    expect(parseOrder("name")).toEqual([
      { column: "name", direction: "asc", nullsFirst: false },
    ]);
  });

  test("parses multiple order clauses", () => {
    expect(parseOrder("name.asc,id.desc")).toEqual([
      { column: "name", direction: "asc", nullsFirst: false },
      { column: "id", direction: "desc", nullsFirst: false },
    ]);
  });

  test("parses nullsfirst", () => {
    expect(parseOrder("name.asc.nullsfirst")).toEqual([
      { column: "name", direction: "asc", nullsFirst: true },
    ]);
  });
});

describe("parseQueryParams", () => {
  test("parses a full query string", () => {
    const url = new URL(
      "http://localhost/users?select=id,name&order=name.asc&limit=10&offset=20&status=eq.active&age=gte.18",
    );
    const result = parseQueryParams(url);

    expect(result.select).toEqual(["id", "name"]);
    expect(result.order).toEqual([
      { column: "name", direction: "asc", nullsFirst: false },
    ]);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
    expect(result.filters).toHaveLength(2);
    expect(result.filters[0]).toEqual({
      column: "status",
      operator: "eq",
      value: "active",
    });
    expect(result.filters[1]).toEqual({
      column: "age",
      operator: "gte",
      value: 18,
    });
  });

  test("returns defaults for empty query", () => {
    const url = new URL("http://localhost/users");
    const result = parseQueryParams(url);

    expect(result.select).toEqual([]);
    expect(result.order).toEqual([]);
    expect(result.limit).toBeUndefined();
    expect(result.offset).toBeUndefined();
    expect(result.filters).toEqual([]);
  });

  test("ignores reserved params as filters", () => {
    const url = new URL(
      "http://localhost/users?select=id&order=name&limit=10&offset=0",
    );
    const result = parseQueryParams(url);

    expect(result.filters).toEqual([]);
  });
});

describe("parseTableFromPath", () => {
  test("extracts table name from simple path", () => {
    expect(parseTableFromPath("/users")).toBe("users");
  });

  test("extracts table name from nested path", () => {
    expect(parseTableFromPath("/api/users")).toBe("users");
  });

  test("returns null for root path", () => {
    expect(parseTableFromPath("/")).toBeNull();
  });

  test("returns null for empty path", () => {
    expect(parseTableFromPath("")).toBeNull();
  });
});
