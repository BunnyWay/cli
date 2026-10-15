import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AdapterClient } from "./client.ts";
import { introspect } from "./introspect.ts";
import { sqliteClient } from "./sqlite.ts";

let db: Database;
let client: AdapterClient;

beforeAll(async () => {
  db = new Database(":memory:");
  client = sqliteClient(db);

  db.exec(`
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
    CREATE TABLE post_tags (
      tag_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id)
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
  db.close();
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
    const users = schema.tables.users!;

    expect(users.columns).toHaveLength(3);
    expect(users.primaryKey).toEqual(["id"]);
    expect(users.uniqueColumns).toContain("email");

    const posts = schema.tables.posts!;
    expect(posts.foreignKeys).toHaveLength(1);
    expect(posts.foreignKeys[0]?.column).toBe("user_id");
    expect(posts.foreignKeys[0]?.referencesTable).toBe("users");
  });

  test("reports every column of a composite primary key, in key order", async () => {
    const schema = await introspect({ client });
    const postTags = schema.tables.post_tags!;

    expect(postTags.primaryKey).toEqual(["post_id", "tag_id"]);
    expect(postTags.columns.every((c) => c.primaryKey)).toBe(true);
  });

  test("only runs statements a read-only libSQL token may run", async () => {
    // libSQL servers check each statement's kind against the token's scope.
    // These PRAGMAs are the ones they classify as reads; anything else (even
    // `PRAGMA foreign_key_list`) needs write access and would break studio,
    // which connects with a read-only token.
    const READ_PRAGMAS =
      /^PRAGMA (table_info|table_xinfo|table_list|index_list|index_info|index_xinfo)\b/i;
    const seen: string[] = [];
    const recording: AdapterClient = {
      prepare: (sql) => {
        seen.push(sql.trim());
        return client.prepare(sql);
      },
    };

    await introspect({ client: recording });

    const notRead = seen.filter(
      (sql) => !/^SELECT\b/i.test(sql) && !READ_PRAGMAS.test(sql),
    );
    expect(notRead).toEqual([]);
  });

  test("uses custom version", async () => {
    const schema = await introspect({ client, version: "2.0.0" });
    expect(schema.version).toBe("2.0.0");
  });
});
