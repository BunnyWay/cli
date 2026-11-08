import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createExecutor } from "@bunny.net/database-adapter";
import { sqliteClient } from "@bunny.net/database-adapter/sqlite";
import type { DatabaseSchema } from "@bunny.net/database-openapi";
import {
  createRestHandler,
  HookRejection,
  type RestHandlerOptions,
} from "./handler.ts";

const schema: DatabaseSchema = {
  version: "1.0.0",
  tables: {
    notes: {
      name: "notes",
      columns: [
        { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
        { name: "owner", type: "TEXT", nullable: false, primaryKey: false },
        { name: "body", type: "TEXT", nullable: false, primaryKey: false },
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
    CREATE TABLE notes (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
    INSERT INTO notes (owner, body) VALUES ('alice', 'first');
    INSERT INTO notes (owner, body) VALUES ('bob', 'second');
  `);
});

const call = (
  options: RestHandlerOptions,
  method: string,
  path: string,
  body?: unknown,
) =>
  createRestHandler(
    createExecutor({ client: sqliteClient(db) }),
    schema,
    options,
  )(
    new Request(`http://db.test${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-user": "alice" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const rows = () => db.query("SELECT owner, body FROM notes ORDER BY id").all();

describe("before hooks", () => {
  test("beforeInsert can fill in columns, and runs before the scope check", async () => {
    const res = await call(
      {
        hooks: {
          beforeInsert: ({ request, rows }) =>
            rows.map((row) => ({
              ...row,
              owner: request.headers.get("x-user"),
            })),
        },
        scope: () => ({ column: "owner", operator: "eq", value: "alice" }),
      },
      "POST",
      "/notes",
      { body: "third" },
    );

    expect(res.status).toBe(201);
    expect(rows()).toContainEqual({ owner: "alice", body: "third" });
  });

  test("beforeUpdate can replace the values and sees the full filters", async () => {
    const seenFilters: unknown[] = [];
    const res = await call(
      {
        hooks: {
          beforeUpdate: ({ values, filters }) => {
            seenFilters.push(filters);

            return { body: String(values.body).toUpperCase() };
          },
        },
      },
      "PATCH",
      "/notes/1",
      { body: "shout" },
    );

    expect(res.status).toBe(200);
    expect(rows()[0]).toEqual({ owner: "alice", body: "SHOUT" });
    expect(seenFilters).toEqual([[{ column: "id", operator: "eq", value: 1 }]]);
  });

  test("a HookRejection refuses the write with its status, and nothing changes", async () => {
    const res = await call(
      {
        hooks: {
          beforeDelete: () => {
            throw new HookRejection("Notes cannot be deleted", 409, "LOCKED");
          },
        },
      },
      "DELETE",
      "/notes/1",
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "Notes cannot be deleted",
      code: "LOCKED",
    });
    expect(rows()).toHaveLength(2);
  });

  test("any other error from a before hook is a 500 and nothing is written", async () => {
    const errors: unknown[] = [];
    const res = await call(
      {
        onError: (err) => errors.push(err),
        hooks: {
          beforeInsert: () => {
            throw new Error("hook crashed");
          },
        },
      },
      "POST",
      "/notes",
      { owner: "alice", body: "never" },
    );

    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(rows()).toHaveLength(2);
  });
});

describe("after hooks", () => {
  test("get the rows each write affected", async () => {
    const events: string[] = [];
    const options: RestHandlerOptions = {
      hooks: {
        afterInsert: ({ table, rows }) => {
          events.push(`insert ${table} ${rows.map((r) => r.body).join(",")}`);
        },
        afterUpdate: ({ rows }) => {
          events.push(`update ${rows.map((r) => r.id).join(",")}`);
        },
        afterDelete: ({ rows }) => {
          events.push(`delete ${rows.map((r) => r.id).join(",")}`);
        },
      },
    };

    await call(options, "POST", "/notes", [
      { owner: "carol", body: "a" },
      { owner: "carol", body: "b" },
    ]);
    await call(options, "PATCH", "/notes?owner=eq.carol", { body: "c" });
    await call(options, "DELETE", "/notes/1");

    expect(events).toEqual(["insert notes a,b", "update 3,4", "delete 1"]);
  });

  test("do not run when no row was affected", async () => {
    const events: string[] = [];
    const res = await call(
      { hooks: { afterDelete: () => void events.push("delete") } },
      "DELETE",
      "/notes/999",
    );

    expect(res.status).toBe(404);
    expect(events).toEqual([]);
  });

  test("a failing after hook is reported but the response still reflects the completed write", async () => {
    const errors: unknown[] = [];
    const res = await call(
      {
        onError: (err) => errors.push(err),
        hooks: {
          afterInsert: () => {
            throw new Error("webhook down");
          },
        },
      },
      "POST",
      "/notes",
      { owner: "alice", body: "saved" },
    );

    expect(res.status).toBe(201);
    expect(rows()).toContainEqual({ owner: "alice", body: "saved" });
    expect(errors).toEqual([new Error("webhook down")]);
  });
});
