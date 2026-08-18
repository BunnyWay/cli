/**
 * Exercises the client against a live database on both Bun and Deno. It creates and drops its own tables.
 *
 * Needs BUNNY_DATABASE_URL and BUNNY_DATABASE_AUTH_TOKEN in the environment:
 *   bun run examples/smoke.ts
 *   deno run --env-file=.env --allow-net --allow-env examples/smoke.ts
 */
import { connect, DatabaseError, ENV_DATABASE_URL } from "../src/index.ts";

// No arguments: url and token come from the environment.
const db = connect();

const url = process.env[ENV_DATABASE_URL] as string;
console.log(`endpoint: ${new URL(url).host}`);

function check(label: string, ok: boolean, detail?: unknown) {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `  ${JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}`}`,
  );
}

// 1. plain select with binding
const one = await db.prepare("SELECT ? AS a, ? AS b").bind(1, "two").first();
check("bind + first", one?.a === 1 && one?.b === "two", one);

// 2. first(column)
const col = await db.prepare("SELECT 42 AS answer").first("answer");
check("first(column)", col === 42, col);

// 3. raw
const raw = await db.prepare("SELECT 1, 'x'").raw();
check("raw", Array.isArray(raw[0]) && raw[0]?.[1] === "x", raw);

// 4. run returns rows plus metadata
const direct = await db.prepare("SELECT 7 AS n").run();
check("run returns rows and columns", direct.rows[0]?.n === 7, direct.columns);

// 5. int64 precision beyond 2^53
const big = await db
  .prepare("SELECT 9007199254740993 AS big, 5 AS small")
  .first();
check(
  "int64 widens to bigint, small stays number",
  typeof big?.big === "bigint" && typeof big?.small === "number",
  big,
);

// 6. blob round trip
const blob = await db
  .prepare("SELECT ? AS b")
  .bind(new Uint8Array([1, 2, 255]))
  .first();
const bytes = blob?.b as Uint8Array;
check("blob round trip", bytes instanceof Uint8Array && bytes[2] === 255, [
  ...bytes,
]);

// 7. null + float
const mixed = await db
  .prepare("SELECT NULL AS n, 1.5 AS f, ? AS bool")
  .bind(true)
  .first();
check(
  "null / float / boolean",
  mixed?.n === null && mixed?.f === 1.5 && mixed?.bool === 1,
  mixed,
);

// 8. batch is atomic and returns per-statement results
const batch = await db.batch([
  db.prepare("CREATE TABLE __probe (id INTEGER PRIMARY KEY, name TEXT)"),
  db.prepare("INSERT INTO __probe (name) VALUES (?)").bind("alice"),
  db
    .prepare("INSERT INTO __probe (name) VALUES (?) RETURNING id, name")
    .bind("bob"),
  db.prepare("SELECT COUNT(*) AS c FROM __probe"),
  db.prepare("DROP TABLE __probe"),
]);
check("batch results align with statements", batch.length === 5, {
  insertRowid: batch[1]?.lastInsertRowid,
  rowsAffected: batch[1]?.rowsAffected,
  returning: batch[2]?.rows,
  count: batch[3]?.rows,
});

// 9. batch rolls back on failure
try {
  await db.batch([
    db.prepare("CREATE TABLE __probe2 (id INTEGER PRIMARY KEY)"),
    db.prepare("INSERT INTO __probe2 (id) VALUES (1)"),
    db.prepare("INSERT INTO __probe2 (id) VALUES (1)"),
  ]);
  check("batch rollback", false, "expected a constraint error");
} catch (error) {
  const code = error instanceof DatabaseError ? error.code : undefined;
  const survived = await db
    .prepare("SELECT name FROM sqlite_master WHERE name = '__probe2'")
    .all();
  check("batch rolls back on failure", survived.length === 0, {
    code,
    message: (error as Error).message,
  });
}

// 10. exec runs a multi-statement script
await db.exec(
  "CREATE TABLE __probe3 (id INTEGER); INSERT INTO __probe3 VALUES (1),(2); DROP TABLE __probe3;",
);
check("exec multi-statement script", true);

// 11. SQL errors surface with a code
try {
  await db.prepare("SELECT * FROM nope_does_not_exist").all();
  check("sql error", false);
} catch (error) {
  const e = error as DatabaseError;
  check("sql error carries code", e instanceof DatabaseError && !!e.code, {
    code: e.code,
    message: e.message,
  });
}

// 12. bad auth surfaces as UNAUTHORIZED
try {
  await connect({ url, authToken: "not-a-real-token" })
    .prepare("SELECT 1")
    .all();
  check("auth error", false);
} catch (error) {
  const e = error as DatabaseError;
  check("bad token -> UNAUTHORIZED", e.code === "UNAUTHORIZED", {
    status: e.status,
    message: e.message,
  });
}

// 13. server rejects TEMP tables outright
try {
  await db.exec("CREATE TEMP TABLE __t (id INTEGER)");
  check(
    "CREATE TEMP TABLE rejected by server",
    false,
    "expected SQL_PARSE_ERROR",
  );
} catch (error) {
  const e = error as DatabaseError;
  check(
    "CREATE TEMP TABLE rejected by server",
    e.code === "SQL_PARSE_ERROR",
    e.message,
  );
}

// 14. statelessness: an uncommitted transaction is discarded when the request ends
await db.exec("BEGIN; CREATE TABLE __probe4 (id INTEGER);");
const leaked = await db
  .prepare("SELECT name FROM sqlite_master WHERE name = ?")
  .bind("__probe4")
  .all();
check(
  "uncommitted work does not leak across requests",
  leaked.length === 0,
  leaked,
);

// 15. rejects a URL carrying credentials
try {
  connect({ url: "libsql://user:pass@db.lite.bunnydb.net" });
  check("reject credentials in URL", false);
} catch (error) {
  check(
    "reject credentials in URL",
    (error as DatabaseError).code === "URL_INVALID",
  );
}

// 16. rejects unbindable values
try {
  db.prepare("SELECT ?").bind(new Date());
  check("reject Date bind", false);
} catch (error) {
  check(
    "reject Date bind with guidance",
    (error as DatabaseError).code === "ARGUMENT_INVALID",
    (error as Error).message,
  );
}
