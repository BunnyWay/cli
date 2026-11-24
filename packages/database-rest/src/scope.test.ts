import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createExecutor } from "@bunny.net/database-adapter";
import { sqliteClient } from "@bunny.net/database-adapter/sqlite";
import type { DatabaseSchema } from "@bunny.net/database-openapi";
import { createRestHandler, type ScopeContext } from "./handler.ts";
import type { Filter } from "./parser.ts";

const schema: DatabaseSchema = {
  version: "1.0.0",
  tables: {
    notes: {
      name: "notes",
      columns: [
        { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
        { name: "owner", type: "TEXT", nullable: false, primaryKey: false },
        { name: "body", type: "TEXT", nullable: false, primaryKey: false },
        { name: "public", type: "INTEGER", nullable: false, primaryKey: false },
      ],
      primaryKey: ["id"],
      foreignKeys: [],
      indexes: [],
      uniqueColumns: [],
    },
  },
};

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 0);
    INSERT INTO notes (owner, body, public) VALUES ('alice', 'alice private', 0);
    INSERT INTO notes (owner, body, public) VALUES ('alice', 'alice public', 1);
    INSERT INTO notes (owner, body, public) VALUES ('bob', 'bob private', 0);
    INSERT INTO notes (owner, body, public) VALUES ('bob', 'bob public', 1);
  `);
});

/** Reads see your own notes plus public ones; writes only touch your own. */
const ownerScope =
  (user: string) =>
  ({ operation }: ScopeContext): Filter =>
    operation === "select"
      ? {
          or: [
            { column: "owner", operator: "eq", value: user },
            { column: "public", operator: "eq", value: 1 },
          ],
        }
      : { column: "owner", operator: "eq", value: user };

const handlerFor = (scope: Parameters<typeof createRestHandler>[2]) =>
  createRestHandler(
    createExecutor({ client: sqliteClient(db) }),
    schema,
    scope,
  );

const call = (
  handler: ReturnType<typeof createRestHandler>,
  method: string,
  path: string,
  body?: unknown,
) =>
  handler(
    new Request(`http://db.test${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const bodies = () =>
  db
    .query("SELECT body FROM notes ORDER BY id")
    .all()
    .map((row) => (row as { body: string }).body);

describe("scope on reads", () => {
  test("list and count only include rows inside the scope", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "GET",
      "/notes?order=id.asc",
    );
    const json = (await res.json()) as { data: { body: string }[] };

    expect(json.data.map((note) => note.body)).toEqual([
      "alice private",
      "alice public",
      "bob public",
    ]);
    expect(res.headers.get("X-Total-Count")).toBe("3");
  });

  test("client filters are ANDed with the scope, so they cannot widen it", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "GET",
      "/notes?owner=eq.bob",
    );
    const json = (await res.json()) as { data: { body: string }[] };

    expect(json.data.map((note) => note.body)).toEqual(["bob public"]);
  });

  test("a single row outside the scope answers 404", async () => {
    const handler = handlerFor({ scope: ownerScope("alice") });

    expect((await call(handler, "GET", "/notes/3")).status).toBe(404);
    expect((await call(handler, "GET", "/notes/4")).status).toBe(200);
  });
});

describe("scope on writes", () => {
  test("update and delete by id outside the scope answer 404 and change nothing", async () => {
    const handler = handlerFor({ scope: ownerScope("alice") });

    expect(
      (await call(handler, "PATCH", "/notes/4", { body: "hijacked" })).status,
    ).toBe(404);
    expect((await call(handler, "DELETE", "/notes/3")).status).toBe(404);
    expect(bodies()).toEqual([
      "alice private",
      "alice public",
      "bob private",
      "bob public",
    ]);
  });

  test("bulk delete only removes rows inside the scope", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "DELETE",
      "/notes?public=eq.1",
    );

    expect(res.status).toBe(200);
    expect(bodies()).toEqual(["alice private", "bob private", "bob public"]);
  });

  test("the scope does not count as the filter a bulk update requires", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "PATCH",
      "/notes",
      { body: "everything" },
    );

    expect(res.status).toBe(400);
  });

  test("an insert matching the scope is written", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "POST",
      "/notes",
      { owner: "alice", body: "new", public: 0 },
    );

    expect(res.status).toBe(201);
    expect(bodies()).toContain("new");
  });

  test("a bulk insert with one row outside the scope writes nothing", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "POST",
      "/notes",
      [
        { owner: "alice", body: "mine", public: 0 },
        { owner: "bob", body: "forged", public: 0 },
      ],
    );

    expect(res.status).toBe(403);
    expect(bodies()).toHaveLength(4);
  });

  test("an insert missing a column the scope checks is refused", async () => {
    const res = await call(
      handlerFor({ scope: ownerScope("alice") }),
      "POST",
      "/notes",
      { body: "no owner", public: 0 },
    );

    expect(res.status).toBe(403);
    expect(bodies()).toHaveLength(4);
  });
});

describe("scope hook", () => {
  test("receives the request, table, and operation for each method", async () => {
    const seen: string[] = [];
    const handler = handlerFor({
      scope: ({ request, table, operation }) => {
        seen.push(`${request.method} ${table} ${operation}`);

        return null;
      },
    });

    await call(handler, "GET", "/notes");
    await call(handler, "POST", "/notes", { owner: "x", body: "y", public: 0 });
    await call(handler, "PATCH", "/notes/1", { body: "z" });
    await call(handler, "DELETE", "/notes/1");

    expect(seen).toEqual([
      "GET notes select",
      "POST notes insert",
      "PATCH notes update",
      "DELETE notes delete",
    ]);
  });

  test("returning false refuses the request with 403", async () => {
    const res = await call(
      handlerFor({ scope: async () => false as const }),
      "GET",
      "/notes",
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      message: "Not allowed by the request scope",
      code: "FORBIDDEN",
    });
  });
});
