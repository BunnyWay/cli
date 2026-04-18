import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { introspect, DEFAULT_EXCLUDE_PATTERNS } from "./introspect.ts";

let client: Client;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });

  await client.executeMultiple(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id)
    );
    CREATE TABLE "__drizzle_migrations" (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL
    );
    CREATE TABLE "_prisma_migrations" (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE "__internal_logs" (
      id INTEGER PRIMARY KEY,
      message TEXT
    );
    CREATE TABLE "schema_migrations" (
      version TEXT PRIMARY KEY
    );
  `);
});

afterAll(() => {
  client.close();
});

describe("introspect", () => {
  test("excludes internal tables by default", async () => {
    const schema = await introspect({ client });
    const tableNames = Object.keys(schema.tables);

    expect(tableNames).toContain("users");
    expect(tableNames).toContain("posts");
    expect(tableNames).not.toContain("__drizzle_migrations");
    expect(tableNames).not.toContain("_prisma_migrations");
    expect(tableNames).not.toContain("__internal_logs");
    expect(tableNames).not.toContain("schema_migrations");
  });

  test("shows all tables when exclude is empty", async () => {
    const schema = await introspect({ client, exclude: [] });
    const tableNames = Object.keys(schema.tables);

    expect(tableNames).toContain("users");
    expect(tableNames).toContain("posts");
    expect(tableNames).toContain("__drizzle_migrations");
    expect(tableNames).toContain("_prisma_migrations");
    expect(tableNames).toContain("__internal_logs");
    expect(tableNames).toContain("schema_migrations");
  });

  test("supports custom exclude patterns", async () => {
    const schema = await introspect({ client, exclude: ["posts"] });
    const tableNames = Object.keys(schema.tables);

    expect(tableNames).toContain("users");
    expect(tableNames).not.toContain("posts");
    // Without default excludes, internal tables show up
    expect(tableNames).toContain("__drizzle_migrations");
  });

  test("supports include to whitelist specific tables", async () => {
    const schema = await introspect({ client, include: ["users"] });
    const tableNames = Object.keys(schema.tables);

    expect(tableNames).toEqual(["users"]);
  });

  test("include overrides exclude", async () => {
    const schema = await introspect({
      client,
      exclude: ["users"],
      include: ["users", "posts"],
    });
    const tableNames = Object.keys(schema.tables);

    expect(tableNames).toContain("users");
    expect(tableNames).toContain("posts");
    expect(tableNames).toHaveLength(2);
  });

  test("wildcard patterns work in include", async () => {
    const schema = await introspect({ client, include: ["__*"] });
    const tableNames = Object.keys(schema.tables);

    expect(tableNames).toContain("__drizzle_migrations");
    expect(tableNames).toContain("__internal_logs");
    expect(tableNames).not.toContain("users");
  });

  test("introspects columns, PKs, FKs, and indexes", async () => {
    const schema = await introspect({ client });
    const users = schema.tables["users"]!;

    expect(users.columns).toHaveLength(3);
    expect(users.primaryKey).toEqual(["id"]);
    expect(users.uniqueColumns).toContain("email");

    const posts = schema.tables["posts"]!;
    expect(posts.foreignKeys).toHaveLength(1);
    expect(posts.foreignKeys[0]!.column).toBe("user_id");
    expect(posts.foreignKeys[0]!.referencesTable).toBe("users");
  });

  test("uses custom version", async () => {
    const schema = await introspect({ client, version: "2.0.0" });
    expect(schema.version).toBe("2.0.0");
  });

  test("DEFAULT_EXCLUDE_PATTERNS is exported and non-empty", () => {
    expect(DEFAULT_EXCLUDE_PATTERNS.length).toBeGreaterThan(0);
    expect(DEFAULT_EXCLUDE_PATTERNS).toContain("__*");
    expect(DEFAULT_EXCLUDE_PATTERNS).toContain("_prisma_migrations");
  });
});
