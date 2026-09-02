# Database Client (`@bunny.net/database-client`)

The SQL client for querying a Bunny Database from application code. `bunny db` provisions and inspects the database; this package is what your app uses at runtime.

It has no dependencies and uses `fetch` and nothing else, so the same code runs on Bunny Edge Scripting (Deno), Bun, and Node (>= 18.17).

## Critical: server-side only

**Never ship this client, or a database auth token, to a browser or any other untrusted client.**

An auth token authorizes the connection, not the query: anything holding it can run whatever SQL that token allows against every table, whatever your UI offers. In client-side code the token shows up in the network tab, the bundle, `localStorage`, and to any injected script. Read-only tokens narrow the damage without fixing it, because they still expose every row of every table and SQLite has no row-level security.

Keep the token on a server and expose only the queries you want to allow. An Edge Script in front of the database is the usual shape (see [Edge Scripting](#edge-scripting) below, and `references/scripts.md` for deploying one).

## Install

```bash
bun add @bunny.net/database-client
```

## Connecting

```ts
import { connect } from "@bunny.net/database-client";

const db = connect();
```

`connect()` reads `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` from the environment, and Edge Scripting injects both.

To populate them locally, `bunny db quickstart --lang typescript` is the shortest path: it resolves the URL, generates a token when there isn't one, and prints the two `.env` lines next to this exact snippet. For a database you are creating anyway, `bunny db create --token --save-env` writes them straight to `.env`, and both flags are needed since `--save-env` has nothing to write without a token. `bunny db link` does not help here: it writes only `.bunny/database.json`, which is how the CLI resolves its own commands, not how your app finds credentials.

Pass them explicitly when you need to:

```ts
const db = connect({
  url: "libsql://your-db.lite.bunnydb.net",
  authToken: "your-token",
});
```

| Option      | Type                     | Default                     | Description                                          |
| ----------- | ------------------------ | --------------------------- | ---------------------------------------------------- |
| `url`       | `string`                 | `BUNNY_DATABASE_URL`        | `libsql://`, `https://`, or `http://` connection URL |
| `authToken` | `string`                 | `BUNNY_DATABASE_AUTH_TOKEN` | Sent as `Authorization: Bearer <token>`              |
| `fetch`     | `typeof fetch`           | global `fetch`              | Override for testing, tracing, or a custom agent     |
| `headers`   | `Record<string, string>` | none                        | Extra headers on every request                       |
| `signal`    | `AbortSignal`            | none                        | Applied to every request                             |
| `timeout`   | `number`                 | none                        | Milliseconds before a single request is aborted      |

A `libsql://` URL is rewritten to `https://`. Credentials in the URL are rejected, both `user:pass@` and an `authToken` query parameter, because URLs end up in logs and referrers; pass `authToken` instead.

Without `timeout` a request waits as long as the runtime allows, so on an edge function a hung fetch can burn the whole invocation. Set one. `timeout` and `signal` compose: whichever fires first aborts. Combining them uses `AbortSignal.any`, which is why the Node floor is 18.17 rather than 18.0.

`connect()` opens no socket and does no I/O, so building the client at module scope is fine, with nothing to warm up or tear down per request.

## Queries

Two ways to build a statement. Both parameterize.

```ts
// Template literal: every ${...} becomes a ? placeholder with its value bound
const note = await db.sql`SELECT * FROM notes WHERE id = ${id}`.first();

// prepare(): reusable and immutable, so keep one around and bind it repeatedly
const byId = db.prepare("SELECT * FROM users WHERE id = ?");
const alice = await byId.bind(1).first();
const bob = await byId.bind(2).first();
```

Only values can be parameterized (a SQLite limit, not a client one). When a table or column name has to vary, build the SQL string with `prepare()`.

### `bind(...values)`

Returns a new statement. Accepts `null`, `boolean`, `number`, `bigint`, `string`, and `Uint8Array`. Positional for `?`, or a single object for SQLite's named forms (`:name`, `@name`, `$name`, with or without the sigil):

```ts
await db.prepare("SELECT * FROM users WHERE id = ? AND active = ?").bind(1, true).all();
await db.prepare("SELECT * FROM users WHERE id = :id").bind({ id: 1 }).all();
```

One statement uses one style: mixing positional values and an object in the same `bind()` throws. So does an interpolated object inside `db.sql` (inside a template it's far more likely a mistake than named parameters).

These throw rather than converting quietly:

- `undefined` — so a mistyped property (`bind(user.nmae)`) surfaces instead of writing NULL. Pass `null` for NULL.
- `Date` — the error suggests `.toISOString()` or `.getTime()`, since guessing would change what lands in the column.

Integer `number`s are sent as INTEGER up to 2^53 and as REAL past it, where every double is already a whole number. Pass a `bigint` for an exact integer that large (within SQLite's signed 64-bit range).

### Executing

Statements do nothing until one of these is called, so `prepare()` and `bind()` are safe to pass around.

```ts
await stmt.all(); // rows as objects
await stmt.first(); // first row, or null
await stmt.first("name"); // one column of the first row, or null
await stmt.raw(); // rows as positional arrays
await stmt.run(); // { rows, columns, rowsAffected, lastInsertRowid }
await stmt.runRaw(); // same metadata, positional rows
```

```ts
const result = await db
  .prepare("INSERT INTO users (name) VALUES (?) RETURNING id")
  .bind("Carol")
  .run();
// { rows: [{ id: 3 }], columns: ["id"], rowsAffected: 1, lastInsertRowid: 3 }
```

Reach for the `raw` variants when a result can contain two columns of the same name, since object rows keep only the last one.

### `db.batch(statements, options?)`

One transaction, one round trip: all statements commit or none do. You get one result per statement, in order, with each row type inferred from its statement.

```ts
const [inserted, count] = await db.batch([
  db.prepare("INSERT INTO users (name) VALUES (?)").bind("Dan"),
  db.prepare("SELECT COUNT(*) AS c FROM users"),
]);
```

If any statement fails, the transaction rolls back and `batch()` throws that statement's error. `batchRaw()` is the same with positional rows.

`{ foreignKeys: false }` brackets the transaction with `PRAGMA foreign_keys=off` and `=on`. Schema changes need it: SQLite's table rebuild procedure and several `ALTER TABLE` forms require enforcement genuinely off, not just deferred to commit. `bunny db migrations apply` runs this way.

### `db.exec(sql)`

Runs a multi-statement script with no parameters and no rows back, so it's mostly for standing up a schema:

```ts
await db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS users_name ON users (name);
`);
```

For anything that runs more than once, use migrations (`bunny db migrations`, see `references/database.md`) instead.

## Errors

Everything throws `DatabaseError`, including failures before any SQL runs, so one `instanceof` check covers the whole surface.

```ts
import { DatabaseError } from "@bunny.net/database-client";

try {
  await db.prepare("INSERT INTO users (email) VALUES (?)").bind("dupe@example.com").run();
} catch (error) {
  if (error instanceof DatabaseError && error.code === "SQLITE_CONSTRAINT") {
    // handle the duplicate
  }
}
```

| Property  | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| `message` | The server's message, or a description of the local validation failure              |
| `code`    | SQLite code (`SQLITE_CONSTRAINT`), or a client code (`UNAUTHORIZED`, `URL_MISSING`) |
| `status`  | HTTP status, when the failure came from the transport rather than from SQL          |

Client codes for pre-SQL failures: `NETWORK` (DNS, TLS, connection refused, or a non-JSON response), `TIMEOUT` (the `timeout` deadline elapsed), `ABORTED` (the `signal` was aborted).

A `DatabaseError` carries the server's message and SQLite code, so returning one straight to a caller can leak schema details. Log it and return something generic.

## Types

Rows are `Record<string, SqlValue>` by default. Type the executor, or type the statement once and let every execution inherit it:

```ts
interface User {
  id: number;
  name: string;
}

const users = await db.prepare("SELECT id, name FROM users").all<User>();

const byId = db.prepare<User>("SELECT id, name FROM users WHERE id = ?");
const alice = await byId.bind(1).first(); // User | null
const both = await byId.bind(1).all(); // User[]
```

A type argument on the executor wins over the statement's. Nothing validates rows at runtime, so the type is only as accurate as the SQL.

| SQLite  | JavaScript                      |
| ------- | ------------------------------- |
| NULL    | `null`                          |
| INTEGER | `number`, or `bigint` past 2^53 |
| REAL    | `number`                        |
| TEXT    | `string`                        |
| BLOB    | `Uint8Array`                    |

SQLite has no boolean type: `bind(true)` stores `1` and reads back as `1`. Integers come back as `number` while they fit exactly and as `bigint` beyond `Number.MAX_SAFE_INTEGER`; the client never rounds a value to make it fit.

## Edge Scripting

Edge Scripting runs Deno, so import straight from npm:

```ts
import * as BunnySDK from "npm:@bunny.net/edgescript-sdk@0.12.1";
import { connect } from "npm:@bunny.net/database-client";

const db = connect();

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const author = url.searchParams.get("author");
  if (!author) return new Response("author required", { status: 400 });

  // Parameterized, and scoped to the columns and rows the caller may see.
  const posts = await db
    .prepare("SELECT id, title FROM posts WHERE author = ? AND published = 1 LIMIT 50")
    .bind(author)
    .all();

  return Response.json(posts);
});
```

This is also the right place to hold a database token: the code and its environment stay on bunny.net's edge, and the browser only sees the response you chose to return.

## Handling tokens

- Keep tokens in environment variables, not source. `connect()` reads them from the environment, so a token never has to appear in code.
- Prefer short-lived, narrow tokens: `bunny db tokens create --read-only --expiry 12h`. Bare `bunny db tokens create` defaults to full access with no expiry, which makes the token you're most likely to have lying around the worst one to lose.
- `bunny db tokens invalidate` revokes every token for the database if one leaks.

## Anti-Patterns

- **Any browser or client-side use.** See the warning at the top: the token is a whole-database credential, and read-only does not fix it.
- **Interpolating values into SQL strings.** Use `db.sql` or `bind()`; string concatenation is how injection gets in.
- **No `timeout` on an edge function.** A hung fetch burns the whole invocation.
- **`db.exec()` for repeatable schema changes.** Use `bunny db migrations` so the change is tracked and applied once.
- **Reusing `db.exec()` or a plain `batch()` for table rebuilds.** `ALTER TABLE` rebuild forms need `{ foreignKeys: false }`.
- **Returning a caught `DatabaseError` to a caller.** It carries schema details; log it and return something generic.
