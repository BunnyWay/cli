import { describe, expect, test } from "bun:test";
import { connect } from "./client.ts";
import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL } from "./env.ts";
import { DatabaseError } from "./errors.ts";

const URL_ = "libsql://db.lite.bunnydb.net";

interface Capture {
  url: string;
  headers: Record<string, string>;
  body: {
    baton: string | null;
    requests: {
      type: string;
      stmt?: { sql: string; args: unknown[]; want_rows: boolean };
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
    expect(capture.body.baton).toBeNull();
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
    expect(row?.["__proto__"]).toBe("evil");
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
      "BEGIN",
      "INSERT INTO t VALUES (1)",
      "INSERT INTO t VALUES (2)",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(steps[1]?.condition).toEqual({ type: "ok", step: 0 });
    expect(steps[3]?.condition).toEqual({ type: "ok", step: 2 });
    expect(steps[4]?.condition).toEqual({
      type: "not",
      cond: { type: "ok", step: 3 },
    });
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
  test("a failed step throws with the server's code", async () => {
    const fake = fakeFetch([
      {
        type: "error",
        error: { message: "no such table: t", code: "SQLITE_UNKNOWN" },
      },
    ]);
    const db = connect({ url: URL_, fetch: fake.fetch });

    const error = (await db
      .prepare("SELECT 1")
      .all()
      .catch((e) => e)) as DatabaseError;

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("SQLITE_UNKNOWN");
    expect(error.message).toBe("no such table: t");
  });

  test("a 401 becomes UNAUTHORIZED and points at the token", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      })) as unknown as typeof fetch;
    const db = connect({ url: URL_, fetch: impl });

    const error = (await db
      .prepare("SELECT 1")
      .all()
      .catch((e) => e)) as DatabaseError;

    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.status).toBe(401);
    expect(error.message).toContain(ENV_DATABASE_AUTH_TOKEN);
  });

  test("a non-JSON error body still yields a usable message", async () => {
    const impl = (async () =>
      new Response("upstream is down", {
        status: 502,
      })) as unknown as typeof fetch;
    const db = connect({ url: URL_, fetch: impl });

    const error = (await db
      .prepare("SELECT 1")
      .all()
      .catch((e) => e)) as DatabaseError;

    expect(error.status).toBe(502);
    expect(error.message).toBe("upstream is down");
  });
});

describe("connect", () => {
  test("falls back to the environment for url and token", async () => {
    const previousUrl = process.env[ENV_DATABASE_URL];
    const previousToken = process.env[ENV_DATABASE_AUTH_TOKEN];
    process.env[ENV_DATABASE_URL] = URL_;
    process.env[ENV_DATABASE_AUTH_TOKEN] = "from-env";

    try {
      const fake = fakeFetch([okExecute(["a"], [[1]])]);
      await connect({ fetch: fake.fetch }).prepare("SELECT 1 AS a").all();

      const capture = fake.captures[0] as Capture;
      expect(capture.url).toBe("https://db.lite.bunnydb.net/v2/pipeline");
      expect(capture.headers.authorization).toBe("Bearer from-env");
    } finally {
      if (previousUrl === undefined) delete process.env[ENV_DATABASE_URL];
      else process.env[ENV_DATABASE_URL] = previousUrl;
      if (previousToken === undefined)
        delete process.env[ENV_DATABASE_AUTH_TOKEN];
      else process.env[ENV_DATABASE_AUTH_TOKEN] = previousToken;
    }
  });

  test("an explicit url wins over the environment", async () => {
    const previousUrl = process.env[ENV_DATABASE_URL];
    process.env[ENV_DATABASE_URL] = "libsql://from-env.lite.bunnydb.net";

    try {
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
    } finally {
      if (previousUrl === undefined) delete process.env[ENV_DATABASE_URL];
      else process.env[ENV_DATABASE_URL] = previousUrl;
    }
  });

  test("names the environment variable when there is no url at all", () => {
    const previousUrl = process.env[ENV_DATABASE_URL];
    delete process.env[ENV_DATABASE_URL];

    try {
      expect(() => connect()).toThrow(ENV_DATABASE_URL);
    } finally {
      if (previousUrl !== undefined)
        process.env[ENV_DATABASE_URL] = previousUrl;
    }
  });
});
