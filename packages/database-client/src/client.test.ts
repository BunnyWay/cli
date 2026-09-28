import { describe, expect, test } from "bun:test";
import { connect } from "./client.ts";
import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL } from "./env.ts";
import { DatabaseError } from "./errors.ts";

const URL_ = "libsql://db.lite.bunnydb.net";

interface Capture {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal | null;
  body: {
    baton: string | null;
    requests: {
      type: string;
      stmt?: {
        sql: string;
        args: unknown[];
        named_args: unknown[];
        want_rows: boolean;
      };
      batch?: { steps: { stmt: { sql: string }; condition?: unknown }[] };
      sql?: string;
    }[];
  };
}

/** A fetch stand-in that records the request and replays canned pipeline results. */
function fakeFetch(results: unknown[], captures: Capture[] = []) {
  const impl = (async (input: string, init?: RequestInit) => {
    captures.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(
      JSON.stringify({ baton: null, base_url: null, results }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { fetch: impl, captures };
}

function okExecute(
  cols: string[],
  rows: unknown[][],
  extra: {
    affected_row_count?: number;
    last_insert_rowid?: string | null;
  } = {},
) {
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: cols.map((name) => ({ name, decltype: null })),
        rows: rows.map((row) =>
          row.map((value) =>
            value === null
              ? { type: "null" }
              : typeof value === "number"
                ? { type: "integer", value: String(value) }
                : { type: "text", value: String(value) },
          ),
        ),
        affected_row_count: extra.affected_row_count ?? 0,
        last_insert_rowid: extra.last_insert_rowid ?? null,
      },
    },
  };
}

describe("transport", () => {
  test("posts one self-contained pipeline to /v2/pipeline", async () => {
    const fake = fakeFetch([okExecute(["a"], [[1]])]);
    const db = connect({ url: URL_, authToken: "tok", fetch: fake.fetch });

    await db.prepare("SELECT 1 AS a").all();

    const capture = fake.captures[0] as Capture;
    expect(capture.url).toBe("https://db.lite.bunnydb.net/v2/pipeline");
    expect(capture.headers.authorization).toBe("Bearer tok");
    expect(capture.headers["content-type"]).toBe("application/json");
    expect(capture.headers["user-agent"]).toBe("bunny-database-client");
    expect(capture.body.baton).toBeNull();
  });

  test("a caller's header replaces the default rather than duplicating it", async () => {
    const fake = fakeFetch([okExecute(["a"], [[1]])]);
    const db = connect({
      url: URL_,
      fetch: fake.fetch,
      headers: { "User-Agent": "bunny-cli/1.2.3", "X-Trace": "abc" },
    });

    await db.prepare("SELECT 1 AS a").all();

    const { headers } = fake.captures[0] as Capture;
    expect(headers["user-agent"]).toBe("bunny-cli/1.2.3");
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers["x-trace"]).toBe("abc");
  });

  test("closes the server-side session in the same request", async () => {
    const fake = fakeFetch([okExecute(["a"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    await db.prepare("SELECT 1 AS a").all();

    const types = (fake.captures[0] as Capture).body.requests.map(
      (r) => r.type,
    );
    expect(types).toEqual(["execute", "close"]);
  });

  test("omits the auth header when no token is configured", async () => {
    const previousToken = process.env[ENV_DATABASE_AUTH_TOKEN];
    delete process.env[ENV_DATABASE_AUTH_TOKEN];

    try {
      const fake = fakeFetch([okExecute(["a"], [[1]])]);
      await connect({ url: URL_, fetch: fake.fetch })
        .prepare("SELECT 1 AS a")
        .all();
      expect(
        (fake.captures[0] as Capture).headers.authorization,
      ).toBeUndefined();
    } finally {
      if (previousToken !== undefined)
        process.env[ENV_DATABASE_AUTH_TOKEN] = previousToken;
    }
  });

  test("caller headers ride along", async () => {
    const fake = fakeFetch([okExecute(["a"], [[1]])]);
    const db = connect({
      url: URL_,
      fetch: fake.fetch,
      headers: { "x-trace": "abc" },
    });
    await db.prepare("SELECT 1 AS a").all();
    expect((fake.captures[0] as Capture).headers["x-trace"]).toBe("abc");
  });
});

describe("statement", () => {
  test("binds arguments positionally in wire form", async () => {
    const fake = fakeFetch([okExecute(["id"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    await db
      .prepare("SELECT * FROM t WHERE a = ? AND b = ?")
      .bind(1, "x")
      .all();

    const stmt = (fake.captures[0] as Capture).body.requests[0]?.stmt;
    expect(stmt?.args).toEqual([
      { type: "integer", value: "1" },
      { type: "text", value: "x" },
    ]);
    expect(stmt?.named_args).toEqual([]);
  });

  test("a single object binds as named parameters", () => {
    const stmt = connect({ url: URL_ })
      .prepare("SELECT :a, @b")
      .bind({ a: 1, ":b": "x" });

    expect(stmt.wire.args).toEqual([]);
    expect(stmt.wire.named_args).toEqual([
      { name: "a", value: { type: "integer", value: "1" } },
      { name: ":b", value: { type: "text", value: "x" } },
    ]);
  });

  test("only a plain object counts as named parameters", () => {
    const db = connect({ url: URL_ });

    expect(
      db.prepare("SELECT ?").bind(new Uint8Array([1, 2])).wire.args,
    ).toEqual([{ type: "blob", base64: "AQI=" }]);
    expect(() => db.prepare("SELECT ?").bind(new Date())).toThrow(
      /cannot bind a Date/,
    );
    expect(() => db.prepare("SELECT ?, :b").bind(1, { b: 2 })).toThrow(
      /cannot mix positional and named/,
    );
  });

  test("bind returns a new statement and leaves the original unbound", async () => {
    const fake = fakeFetch([okExecute(["id"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    const base = db.prepare("SELECT ?");

    const bound = base.bind(5);

    expect(bound).not.toBe(base);
    expect(base.wire.args).toEqual([]);
    expect(bound.wire.args).toEqual([{ type: "integer", value: "5" }]);
  });

  test("all returns rows as objects", async () => {
    const fake = fakeFetch([
      okExecute(
        ["id", "name"],
        [
          [1, "a"],
          [2, "b"],
        ],
      ),
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    expect(await db.prepare("SELECT id, name FROM t").all()).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  test("first returns only the first row", async () => {
    const fake = fakeFetch([okExecute(["id"], [[1], [2]])]);
    const row = await connect({ url: URL_, fetch: fake.fetch })
      .prepare("SELECT id")
      .first();
    expect(row).toEqual({ id: 1 });
  });

  test("first is null when there are no rows", async () => {
    const fake = fakeFetch([okExecute(["id"], [])]);
    const row = await connect({ url: URL_, fetch: fake.fetch })
      .prepare("SELECT id")
      .first();
    expect(row).toBeNull();
  });

  test("first(column) pulls a single value out", async () => {
    const fake = fakeFetch([okExecute(["c"], [[42]])]);
    expect(
      await connect({ url: URL_, fetch: fake.fetch })
        .prepare("SELECT c")
        .first("c"),
    ).toBe(42);
  });

  test("first(column) on an empty result is null, not an error", async () => {
    const fake = fakeFetch([okExecute(["c"], [])]);
    expect(
      await connect({ url: URL_, fetch: fake.fetch })
        .prepare("SELECT c")
        .first("c"),
    ).toBeNull();
  });

  test("first(column) names the available columns when the column is absent", async () => {
    const fake = fakeFetch([okExecute(["a", "b"], [[1, 2]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    await expect(db.prepare("SELECT a, b").first("nope")).rejects.toThrow(
      /got a, b/,
    );
  });

  test("first(column) does not fall back to inherited object members", async () => {
    const fake = fakeFetch([okExecute(["a"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    await expect(db.prepare("SELECT a").first("toString")).rejects.toThrow(
      /not in the result/,
    );
  });

  test("a column named __proto__ survives as a real row field", async () => {
    const fake = fakeFetch([okExecute(["__proto__", "n"], [["evil", 7]])]);
    const row = await connect({ url: URL_, fetch: fake.fetch })
      .prepare("SELECT '__proto__', n")
      .first();
    // Assert an own data property, not a prototype read: that distinction is the whole point of the null-prototype row.
    expect(Object.getOwnPropertyDescriptor(row ?? {}, "__proto__")?.value).toBe(
      "evil",
    );
    expect(row?.n).toBe(7);
  });

  test("raw returns positional arrays", async () => {
    const fake = fakeFetch([okExecute(["id", "name"], [[1, "a"]])]);
    expect(
      await connect({ url: URL_, fetch: fake.fetch }).prepare("SELECT *").raw(),
    ).toEqual([[1, "a"]]);
  });

  test("run exposes write metadata alongside rows", async () => {
    const fake = fakeFetch([
      okExecute(["id"], [[9]], {
        affected_row_count: 1,
        last_insert_rowid: "9",
      }),
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const result = await db
      .prepare("INSERT INTO t VALUES (?) RETURNING id")
      .bind("a")
      .run();

    expect(result).toEqual({
      rows: [{ id: 9 }],
      columns: ["id"],
      rowsAffected: 1,
      lastInsertRowid: 9,
    });
  });

  test("a statement is inert until one of its execute methods is called", async () => {
    const fake = fakeFetch([okExecute(["id"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    db.prepare("DELETE FROM users").bind();

    expect(fake.captures).toHaveLength(0);
  });

  test("names unaliased columns rather than dropping them", async () => {
    const fake = fakeFetch([
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: [{ name: null, decltype: null }],
            rows: [[{ type: "integer", value: "1" }]],
            affected_row_count: 0,
            last_insert_rowid: null,
          },
        },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    expect(await db.prepare("SELECT 1").all()).toEqual([{ column1: 1 }]);
  });
});

interface User {
  id: number;
  name: string;
}

describe("typed statements", () => {
  test("prepare carries the row type to every executor", async () => {
    const fake = fakeFetch([okExecute(["id", "name"], [[1, "a"]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    const byId = db.prepare<User>("SELECT id, name FROM users WHERE id = ?");

    const users = await byId.bind(1).all();
    const user = await byId.bind(1).first();

    // Typed as User[] and User | null rather than Row, so these read without a cast.
    expect(users[0]?.name).toBe("a");
    expect(user?.id).toBe(1);
  });

  test("a call-site type argument still wins", async () => {
    const fake = fakeFetch([okExecute(["id"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const rows = await db.prepare<User>("SELECT id FROM users").all<{
      id: number;
    }>();

    expect(rows).toEqual([{ id: 1 }]);
  });

  test("batch infers the row type from its statements", async () => {
    const fake = fakeFetch([
      {
        type: "ok",
        response: {
          type: "batch",
          result: {
            step_results: [
              null,
              okExecute(["id", "name"], [[1, "a"]]).response.result,
              null,
              null,
            ],
            step_errors: [null, null, null, null],
          },
        },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const [users] = await db.batch([
      db.prepare<User>("SELECT id, name FROM users"),
    ]);

    // Typed as string | undefined rather than SqlValue, so batch inherited User.
    const name: string | undefined = users.rows[0]?.name;
    expect(name).toBe("a");
  });

  test("a mixed batch keeps each statement's own row type", async () => {
    const fake = fakeFetch([
      {
        type: "ok",
        response: {
          type: "batch",
          result: {
            step_results: [
              null,
              okExecute(["id", "name"], [[1, "a"]]).response.result,
              okExecute(["c"], [[2]]).response.result,
              null,
              null,
            ],
            step_errors: [null, null, null, null, null],
          },
        },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const [users, counts] = await db.batch([
      db.prepare<User>("SELECT id, name FROM users"),
      db.prepare("SELECT COUNT(*) AS c FROM users"),
    ]);

    // Result<User> and Result<Row> respectively, so name reads as a string and c as a SqlValue.
    const name: string | undefined = users.rows[0]?.name;
    expect(name).toBe("a");
    expect(counts.rows[0]?.c).toBe(2);
  });

  test("column reads are unaffected by the row type", async () => {
    const fake = fakeFetch([okExecute(["name"], [["a"]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const name = await db.prepare<User>("SELECT name FROM users").first("name");

    expect(name).toBe("a");
  });
});

describe("sql template", () => {
  test("interpolations become positional placeholders", () => {
    const stmt = connect({ url: URL_ })
      .sql`SELECT * FROM t WHERE a = ${1} AND b = ${"x"}`;

    expect(stmt.wire.sql).toBe("SELECT * FROM t WHERE a = ? AND b = ?");
    expect(stmt.wire.args).toEqual([
      { type: "integer", value: "1" },
      { type: "text", value: "x" },
    ]);
    expect(stmt.wire.named_args).toEqual([]);
  });

  test("a template with nothing interpolated is left alone", () => {
    const stmt = connect({ url: URL_ }).sql`SELECT 1 AS a`;

    expect(stmt.wire.sql).toBe("SELECT 1 AS a");
    expect(stmt.wire.args).toEqual([]);
  });

  test("an interpolated object is rejected rather than read as named parameters", () => {
    const db = connect({ url: URL_ });

    expect(() => db.sql`SELECT ${{ a: 1 }}`).toThrow(/cannot bind value/);
  });

  test("carries a row type like prepare does", async () => {
    interface Note {
      id: number;
    }
    const fake = fakeFetch([okExecute(["id"], [[1]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const note = await db.sql<Note>`SELECT id FROM notes`.first();
    const id: number | undefined = note?.id;

    expect(id).toBe(1);
  });

  test("executes like any other statement", async () => {
    const fake = fakeFetch([okExecute(["id"], [[7]])]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    expect(await db.sql`SELECT id FROM t WHERE id = ${7}`.first("id")).toBe(7);

    const stmt = (fake.captures[0] as Capture).body.requests[0]?.stmt;
    expect(stmt?.sql).toBe("SELECT id FROM t WHERE id = ?");
    expect(stmt?.args).toEqual([{ type: "integer", value: "7" }]);
  });
});

describe("batch", () => {
  function okBatch(count: number) {
    const step = {
      cols: [],
      rows: [],
      affected_row_count: 1,
      last_insert_rowid: null,
    };
    return {
      type: "ok",
      response: {
        type: "batch",
        result: {
          step_results: Array.from({ length: count + 3 }, () => step),
          step_errors: Array.from({ length: count + 3 }, () => null),
        },
      },
    };
  }

  test("wraps the statements in a transaction with a rollback fallback", async () => {
    const fake = fakeFetch([okBatch(2)]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    await db.batch([
      db.prepare("INSERT INTO t VALUES (1)"),
      db.prepare("INSERT INTO t VALUES (2)"),
    ]);

    const steps =
      (fake.captures[0] as Capture).body.requests[0]?.batch?.steps ?? [];
    expect(steps.map((s) => s.stmt.sql)).toEqual([
      "BEGIN DEFERRED",
      "INSERT INTO t VALUES (1)",
      "INSERT INTO t VALUES (2)",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(steps[1]?.condition).toEqual({ type: "ok", step: 0 });
    expect(steps[3]?.condition).toEqual({ type: "ok", step: 2 });
    // Guarded on BEGIN so a failed BEGIN never rolls back a transaction the batch did not open.
    expect(steps[4]?.condition).toEqual({
      type: "and",
      conds: [
        { type: "ok", step: 0 },
        { type: "not", cond: { type: "ok", step: 3 } },
      ],
    });
  });

  test("mode picks the BEGIN variant", async () => {
    const fake = fakeFetch([okBatch(1)]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    await db.batch([db.prepare("INSERT INTO t VALUES (1)")], {
      mode: "immediate",
    });

    const steps =
      (fake.captures[0] as Capture).body.requests[0]?.batch?.steps ?? [];
    expect(steps[0]?.stmt.sql).toBe("BEGIN IMMEDIATE");
  });

  test("rejects a caller statement that would break the transaction", async () => {
    const fake = fakeFetch([]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    for (const sql of [
      "COMMIT",
      "  begin immediate",
      "-- note\nROLLBACK",
      "/* c */ END",
    ]) {
      const error = (await db
        .batch([db.prepare("SELECT 1"), db.prepare(sql)])
        .catch((e) => e)) as DatabaseError;
      expect(error.code).toBe("ARGUMENT_INVALID");
      expect(error.batchIndex).toBe(1);
    }
    expect(fake.captures).toHaveLength(0);
  });

  test("returns one result per caller statement, not per wire step", async () => {
    const fake = fakeFetch([okBatch(2)]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const results = await db.batch([
      db.prepare("INSERT INTO t VALUES (1)"),
      db.prepare("SELECT 1"),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.rowsAffected).toBe(1);
  });

  test("foreignKeys: false brackets the transaction with the pragmas", async () => {
    // The pragmas sit outside BEGIN/COMMIT because SQLite ignores them within a transaction.
    const fake = fakeFetch([okBatch(4)]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    await db.batch(
      [
        db.prepare("ALTER TABLE parent RENAME TO parent_old"),
        db.prepare("DROP TABLE parent_old"),
      ],
      { foreignKeys: false },
    );

    const steps =
      (fake.captures[0] as Capture).body.requests[0]?.batch?.steps ?? [];
    expect(steps.map((s) => s.stmt.sql)).toEqual([
      "PRAGMA foreign_keys=off",
      "BEGIN DEFERRED",
      "ALTER TABLE parent RENAME TO parent_old",
      "DROP TABLE parent_old",
      "COMMIT",
      "ROLLBACK",
      "PRAGMA foreign_keys=on",
    ]);
    expect(steps[2]?.condition).toEqual({ type: "ok", step: 1 });
    expect(steps[3]?.condition).toEqual({ type: "ok", step: 2 });
    expect(steps[4]?.condition).toEqual({ type: "ok", step: 3 });
    expect(steps[5]?.condition).toEqual({
      type: "and",
      conds: [
        { type: "ok", step: 1 },
        { type: "not", cond: { type: "ok", step: 4 } },
      ],
    });
  });

  test("unchecked results line up with the caller's statements, not the pragmas", async () => {
    const fake = fakeFetch([
      {
        type: "ok",
        response: {
          type: "batch",
          result: {
            // PRAGMA, BEGIN, stmt A, stmt B, COMMIT, ROLLBACK, PRAGMA
            step_results: [
              null,
              null,
              {
                cols: [{ name: "a" }],
                rows: [],
                affected_row_count: 11,
                last_insert_rowid: null,
              },
              {
                cols: [{ name: "b" }],
                rows: [],
                affected_row_count: 22,
                last_insert_rowid: null,
              },
              null,
              null,
              null,
            ],
            step_errors: Array.from({ length: 7 }, () => null),
          },
        },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const results = await db.batch(
      [db.prepare("SELECT 'a'"), db.prepare("SELECT 'b'")],
      { foreignKeys: false },
    );

    expect(results.map((r) => r.rowsAffected)).toEqual([11, 22]);
    expect(results.map((r) => r.columns)).toEqual([["a"], ["b"]]);
  });

  test("an empty batch is a no-op that sends nothing", async () => {
    const fake = fakeFetch([]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    expect(await db.batch([])).toEqual([]);
    expect(fake.captures).toHaveLength(0);
  });

  test("surfaces the failing step's error", async () => {
    const fake = fakeFetch([
      {
        type: "ok",
        response: {
          type: "batch",
          result: {
            step_results: [null, null, null, null],
            step_errors: [
              null,
              {
                message: "UNIQUE constraint failed",
                code: "SQLITE_CONSTRAINT",
              },
              null,
              null,
            ],
          },
        },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const error = (await db
      .batch([db.prepare("INSERT INTO t VALUES (1)")])
      .catch((e) => e)) as DatabaseError;

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("SQLITE_CONSTRAINT");
    expect(error.batchIndex).toBe(0);
  });

  test("a failed BEGIN or COMMIT carries no statement index", async () => {
    const fake = fakeFetch([
      {
        type: "ok",
        response: {
          type: "batch",
          result: {
            step_results: [null, null, null, null],
            step_errors: [
              { message: "database is locked", code: "SQLITE_BUSY" },
              null,
              null,
              null,
            ],
          },
        },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const error = (await db
      .batch([db.prepare("INSERT INTO t VALUES (1)")])
      .catch((e) => e)) as DatabaseError;

    expect(error.code).toBe("SQLITE_BUSY");
    expect(error.batchIndex).toBeUndefined();
  });
});

describe("exec", () => {
  test("sends the script as a single sequence request", async () => {
    const fake = fakeFetch([{ type: "ok", response: { type: "sequence" } }]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    await db.exec("CREATE TABLE a (id INT); CREATE TABLE b (id INT);");

    const request = (fake.captures[0] as Capture).body.requests[0];
    expect(request?.type).toBe("sequence");
    expect(request?.sql).toBe(
      "CREATE TABLE a (id INT); CREATE TABLE b (id INT);",
    );
  });
});

describe("errors", () => {
  /** Run one statement against `impl` and return the DatabaseError it rejects with. */
  const failure = async (impl: typeof fetch): Promise<DatabaseError> =>
    (await connect({ url: URL_, fetch: impl })
      .prepare("SELECT 1")
      .all()
      .catch((e) => e)) as DatabaseError;

  const responds = (body: string, init?: ResponseInit) =>
    (async () => new Response(body, init)) as unknown as typeof fetch;

  test("a failed step throws with the server's code", async () => {
    const error = await failure(
      fakeFetch([
        {
          type: "error",
          error: { message: "no such table: t", code: "SQLITE_UNKNOWN" },
        },
      ]).fetch,
    );

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("SQLITE_UNKNOWN");
    expect(error.message).toBe("no such table: t");
  });

  test("transport failures arrive as DatabaseError, classified by cause", async () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    const cases = [
      [new TypeError("fetch failed"), "NETWORK"],
      [named("AbortError"), "ABORTED"],
      [named("TimeoutError"), "TIMEOUT"],
    ] as const;

    for (const [thrown, code] of cases) {
      const error = await failure((async () => {
        throw thrown;
      }) as unknown as typeof fetch);

      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.code).toBe(code);
    }
  });

  test("a body that is not JSON is a transport failure too", async () => {
    expect((await failure(responds("<html>gateway</html>"))).code).toBe(
      "NETWORK",
    );
  });

  test("timeout attaches a deadline signal to the request", async () => {
    const fake = fakeFetch([]);

    await connect({ url: URL_, fetch: fake.fetch, timeout: 1000 })
      .exec("SELECT 1")
      .catch(() => undefined);

    expect((fake.captures[0] as Capture).signal).toBeInstanceOf(AbortSignal);
  });

  test("a 401 becomes UNAUTHORIZED and points at the token", async () => {
    const error = await failure(
      responds(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.status).toBe(401);
    expect(error.message).toContain(ENV_DATABASE_AUTH_TOKEN);
  });

  test("a 200 without a results array is a protocol error, not a TypeError", async () => {
    const error = await failure(responds(JSON.stringify({ ok: true })));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("PROTOCOL");
  });

  test("the positional constructor still works for callers of 0.0.x", () => {
    const error = new DatabaseError("boom", "SQLITE_BUSY", 503);

    expect(error.code).toBe("SQLITE_BUSY");
    expect(error.status).toBe(503);
    expect(error.cause).toBeUndefined();

    const statusOnly = new DatabaseError("boom", undefined, 502);
    expect(statusOnly.code).toBeUndefined();
    expect(statusOnly.status).toBe(502);
  });

  test("a comment-heavy statement is scanned without blowing up", async () => {
    const fake = fakeFetch([]);
    const db = connect({ url: URL_, fetch: fake.fetch });
    const sql = `${" /*".repeat(5000)} COMMIT`;

    const error = (await db
      .batch([db.prepare(sql)])
      .catch((e) => e)) as DatabaseError;

    // Unterminated comment: no keyword found, so it is sent as-is rather than rejected.
    expect(error.code).not.toBe("ARGUMENT_INVALID");
  });

  test("transport errors keep the underlying error as cause", async () => {
    const thrown = new TypeError("fetch failed");
    const error = await failure((async () => {
      throw thrown;
    }) as unknown as typeof fetch);

    expect(error.cause).toBe(thrown);
  });

  test("an error body that is JSON but not an object falls back to the status", async () => {
    const error = await failure(responds("null", { status: 500 }));

    expect(error.message).toBe("database request failed with HTTP 500");
    expect(error.status).toBe(500);
  });

  test("a timeout that is not a positive number is rejected up front", () => {
    // Node throws on fractions and silently clamps anything past 2^31-1 to 1ms.
    for (const timeout of [
      0,
      -1,
      1.5,
      2 ** 31,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => connect({ url: URL_, timeout })).toThrow(
        /timeout must be a positive integer/,
      );
    }
  });

  test("a non-JSON error body still yields a usable message", async () => {
    const error = await failure(responds("upstream is down", { status: 502 }));

    expect(error.status).toBe(502);
    expect(error.message).toBe("upstream is down");
  });
});

describe("connect", () => {
  /** Run `fn` with `vars` applied to the environment, restoring what was there before. */
  async function withEnv(
    vars: Record<string, string | undefined>,
    fn: () => Promise<void> | void,
  ) {
    const previous = Object.keys(vars).map(
      (key) => [key, process.env[key]] as const,
    );
    const apply = (
      entries: readonly (readonly [string, string | undefined])[],
    ) => {
      for (const [key, value] of entries) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };

    apply(Object.entries(vars));
    try {
      await fn();
    } finally {
      apply(previous);
    }
  }

  test("falls back to the environment for url and token", async () => {
    await withEnv(
      { [ENV_DATABASE_URL]: URL_, [ENV_DATABASE_AUTH_TOKEN]: "from-env" },
      async () => {
        const fake = fakeFetch([okExecute(["a"], [[1]])]);
        await connect({ fetch: fake.fetch }).prepare("SELECT 1 AS a").all();

        const capture = fake.captures[0] as Capture;
        expect(capture.url).toBe("https://db.lite.bunnydb.net/v2/pipeline");
        expect(capture.headers.authorization).toBe("Bearer from-env");
      },
    );
  });

  test("an explicit url wins over the environment", async () => {
    await withEnv(
      { [ENV_DATABASE_URL]: "libsql://from-env.lite.bunnydb.net" },
      async () => {
        const fake = fakeFetch([okExecute(["a"], [[1]])]);
        await connect({
          url: "libsql://explicit.lite.bunnydb.net",
          fetch: fake.fetch,
        })
          .prepare("SELECT 1 AS a")
          .all();

        expect((fake.captures[0] as Capture).url).toBe(
          "https://explicit.lite.bunnydb.net/v2/pipeline",
        );
      },
    );
  });

  test("an empty url falls back to the environment like a missing one", async () => {
    const fake = fakeFetch([okExecute(["a"], [])]);
    await withEnv({ [ENV_DATABASE_URL]: URL_ }, async () => {
      await connect({ url: "", fetch: fake.fetch }).exec("SELECT 1");
      expect((fake.captures[0] as Capture).url).toBe(
        "https://db.lite.bunnydb.net/v2/pipeline",
      );
    });
  });

  test("names the environment variable when there is no url at all", async () => {
    await withEnv({ [ENV_DATABASE_URL]: undefined }, () => {
      expect(() => connect()).toThrow(ENV_DATABASE_URL);
    });
  });
});
