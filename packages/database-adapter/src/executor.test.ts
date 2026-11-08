import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { connect } from "@bunny.net/database-client";
import type { AdapterClient } from "./client.ts";
import { createExecutor } from "./executor.ts";
import { sqliteClient } from "./sqlite.ts";

// The production client must keep satisfying the adapter surface, batch() included.
const _productionClientFits: AdapterClient = connect({
  url: "https://example.lite.bunnydb.net",
  authToken: "token",
});

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(
    "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL UNIQUE)",
  );
});

const bodies = () =>
  db
    .query("SELECT body FROM notes ORDER BY id")
    .all()
    .map((row) => (row as { body: string }).body);

describe("createExecutor batch()", () => {
  test("commits every statement and returns results in statement order", async () => {
    const executor = createExecutor({ client: sqliteClient(db) });

    const results = await executor.batch!([
      { sql: "INSERT INTO notes (body) VALUES (?)", args: ["first"] },
      { sql: "INSERT INTO notes (body) VALUES (?)", args: ["second"] },
      { sql: "SELECT count(*) AS total FROM notes", args: [] },
    ]);

    expect(bodies()).toEqual(["first", "second"]);
    expect(results[2]).toEqual({ columns: ["total"], rows: [{ total: 2 }] });
  });

  test("applies nothing when any statement fails", async () => {
    const executor = createExecutor({ client: sqliteClient(db) });

    await expect(
      executor.batch!([
        { sql: "INSERT INTO notes (body) VALUES (?)", args: ["kept?"] },
        { sql: "INSERT INTO notes (body) VALUES (?)", args: ["kept?"] },
      ]),
    ).rejects.toThrow(/UNIQUE/);
    expect(bodies()).toEqual([]);
  });

  test("asks the client for an immediate transaction", async () => {
    const client = sqliteClient(db);
    const modes: unknown[] = [];
    const spy: AdapterClient = {
      prepare: client.prepare,
      batch: (statements, options) => {
        modes.push(options?.mode);

        return client.batch!(statements, options);
      },
    };

    await createExecutor({ client: spy }).batch!([
      { sql: "INSERT INTO notes (body) VALUES (?)", args: ["x"] },
    ]);

    expect(modes).toEqual(["immediate"]);
  });

  test("leaves batch() off when the client cannot batch", () => {
    const executor = createExecutor({
      client: { prepare: sqliteClient(db).prepare },
    });

    expect(executor.batch).toBeUndefined();
  });
});
