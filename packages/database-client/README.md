# @bunny.net/database-client

A small SQL client for [Bunny Database](https://bunny.net). It has no dependencies and uses `fetch` and nothing else, so the same code runs on Bunny Edge Scripting (Deno), Bun, and Node.

> [!WARNING]
> **Server-side only. Never ship this to a browser or any other untrusted client.**
>
> An auth token grants access to the whole database, and this client sends raw SQL. Put either one in client-side code and every visitor can read and write every table, whatever your UI happens to offer them. [Why not the browser](#why-not-the-browser) has the details.

## Install

```bash
bun add @bunny.net/database-client
```

## Quick start

`connect()` reads `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` from the environment, which `bunny db quickstart --lang typescript` prints for you (or `bunny db create --token --save-env` writes directly), and which Edge Scripting already sets:

```ts
import { connect } from "@bunny.net/database-client";

const db = connect();

const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(1).first();
```

Pass them explicitly when you need to:

```ts
const db = connect({
  url: "libsql://your-db.lite.bunnydb.net",
  authToken: "your-token",
});
```

Runnable examples for Edge Scripting, Bun, Node, Hono, Next.js, Astro, and SvelteKit live in [`packages/database-client/examples`](https://github.com/BunnyWay/cli/tree/main/packages/database-client/examples).

## API

### `connect(config?)`

Returns a `Database`. Every option is optional.

| Option      | Type                     | Default                     | Description                                                                           |
| ----------- | ------------------------ | --------------------------- | ------------------------------------------------------------------------------------- |
| `url`       | `string`                 | `BUNNY_DATABASE_URL`        | `libsql://`, `https://`, or `http://` connection URL.                                 |
| `authToken` | `string`                 | `BUNNY_DATABASE_AUTH_TOKEN` | Sent as `Authorization: Bearer <token>`.                                              |
| `fetch`     | `typeof fetch`           | global `fetch`              | Override for testing, tracing, or a custom agent.                                     |
| `headers`   | `Record<string, string>` | none                        | Extra headers on every request.                                                       |
| `signal`    | `AbortSignal`            | none                        | Applied to every request.                                                             |
| `timeout`   | `number`                 | none                        | Milliseconds before a single request is aborted. A positive integer up to 2147483647. |

The client rewrites a `libsql://` URL to `https://`. It rejects credentials in the URL, both `user:pass@` and an `authToken` query parameter, so pass `authToken` instead. Dropping a token silently would leave you debugging an unexplained 401.

Every request carries `User-Agent: bunny-database-client`. Header names in `headers` are matched case-insensitively, so passing your own `User-Agent` replaces that default instead of sending both.

Without `timeout` a request waits as long as the runtime allows, which on an edge function means a hung fetch can burn the whole invocation. `timeout` and `signal` compose: whichever fires first aborts the request.

### `db.prepare(sql)`

Returns a `Statement`. Statements are immutable, so you can keep one around and bind it as often as you like.

```ts
const byId = db.prepare("SELECT * FROM users WHERE id = ?");

const alice = await byId.bind(1).first();
const bob = await byId.bind(2).first();
```

Pass a row type to have it flow through every execution of that statement. See [Types](#types).

### ``db.sql`...` ``

A template literal that binds every interpolated value, so the shortest way to write a query is also the parameterized one:

```ts
const note = await db.sql`SELECT * FROM notes WHERE id = ${id}`.first();
```

Each `${...}` becomes a `?` placeholder and its value is bound, never spliced into the SQL string. It returns a `Statement`, so everything under [Executing](#executing) applies unchanged.

Values follow the same rules as `bind()`, with one difference: an interpolated object throws instead of being read as named parameters, since inside a template it is far more likely to be a mistake.

Pass a row type the same way as `prepare()`, as ``db.sql<User>`...` ``.

Only values can be parameterized, which is a SQLite limit rather than a client one. Build the statement with `prepare()` when a table or column name has to vary.

### `statement.bind(...values)`

Binds parameters and returns a new statement. Accepts `null`, `boolean`, `number`, `bigint`, `string`, and `Uint8Array`.

Pass values in order for `?` placeholders:

```ts
await db.prepare("SELECT * FROM users WHERE id = ? AND active = ?").bind(1, true).all();
```

Pass a single object for SQLite's named forms, `:name`, `@name`, and `$name`:

```ts
await db
  .prepare("SELECT * FROM users WHERE id = :id AND active = :active")
  .bind({ id: 1, active: true })
  .all();
```

Names may carry the sigil or leave it off, so `{ id: 1 }` and `{ ":id": 1 }` both bind `:id`. One statement uses one style: mixing positional values and an object in the same `bind()` call throws rather than picking a winner for you.

`undefined` throws rather than binding NULL, so a mistyped property (`bind(user.nmae)`) surfaces instead of quietly writing NULL. Pass `null` when you mean NULL.

Anything else throws instead of being quietly converted, because SQLite has nowhere to put it. `Date` gets its own message suggesting `.toISOString()` or `.getTime()`, since guessing which one you meant would change what ends up in the column.

Integer `number`s are sent as INTEGER while they fit exactly, up to 2^53. Past that every double is a whole number, so the client sends it as REAL, which stores the value as is. Pass a `bigint` when you need an exact integer that large. Bigints must fit SQLite's signed 64-bit range.

### Executing

Four ways to run a statement:

```ts
const rows = await db.prepare("SELECT id, name FROM users").all();
// [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]

const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(1).first();
// { id: 1, name: "Alice" }  or  null

const name = await db.prepare("SELECT name FROM users WHERE id = ?").bind(1).first("name");
// "Alice"  or  null

const rows = await db.prepare("SELECT id, name FROM users").raw();
// [[1, "Alice"], [2, "Bob"]]
```

`run()` returns rows plus write metadata:

```ts
const result = await db
  .prepare("INSERT INTO users (name) VALUES (?) RETURNING id")
  .bind("Carol")
  .run();

// {
//   rows: [{ id: 3 }],
//   columns: ["id"],
//   rowsAffected: 1,
//   lastInsertRowid: 3,
// }
```

`runRaw()` returns the same metadata with rows as positional arrays. Reach for it when a result may contain two columns of the same name, since object rows keep only the last one:

```ts
const result = await db.prepare("SELECT a.id, b.id FROM a JOIN b").runRaw();
// { rows: [[1, 99]], columns: ["id", "id"], rowsAffected: 0, lastInsertRowid: null }
```

Statements do nothing until one of these is called, so `prepare()` and `bind()` are safe to pass around.

### `db.batch(statements, options?)`

Runs every statement in one transaction and one round trip. All of them commit or none do.

```ts
const [inserted, count] = await db.batch([
  db.prepare("INSERT INTO users (name) VALUES (?)").bind("Dan"),
  db.prepare("SELECT COUNT(*) AS c FROM users"),
]);
```

You get one `Result` per statement you passed, in order. `batchRaw()` is the same but with positional rows. If any statement fails the transaction rolls back and `batch()` throws that statement's error, with `error.batchIndex` set to the position of the statement that failed.

The batch is the transaction, so a statement of your own that starts with `BEGIN`, `COMMIT`, `END`, or `ROLLBACK` is rejected before anything is sent. Savepoints are fine.

`{ mode: "immediate" }` opens the transaction with `BEGIN IMMEDIATE`, which takes the write lock up front. SQLite's default, `deferred`, takes it at the first write instead, so a batch that reads and then writes can fail with `SQLITE_BUSY` if another writer got in between. Use `immediate` for batches you know will write. `exclusive` is also accepted.

`batch()` infers each result's row type from its statement, so a `prepare<User>(...)` statement comes back as `Result<User>` even next to untyped ones. See [Types](#types).

`{ foreignKeys: false }` brackets the transaction with `PRAGMA foreign_keys=off` and `=on`. Schema changes need it: SQLite's table rebuild procedure and several `ALTER TABLE` forms require enforcement genuinely off, not merely deferred to commit. `bunny db migrations apply` runs this way.

```ts
await db.batch(
  [
    db.prepare("CREATE TABLE users_new (id INTEGER PRIMARY KEY, email TEXT NOT NULL)"),
    db.prepare("INSERT INTO users_new SELECT id, email FROM users"),
    db.prepare("DROP TABLE users"),
    db.prepare("ALTER TABLE users_new RENAME TO users"),
  ],
  { foreignKeys: false, mode: "immediate" },
);
```

Keep that order: build the replacement under a temporary name, drop the original, then rename. Renaming the original out of the way first looks equivalent but is not, because with foreign keys off SQLite rewrites every `REFERENCES users` in other tables to follow the rename, and they end up pointing at a table you are about to drop.

### `db.exec(sql)`

Runs a multi-statement script. It takes no parameters and returns no rows, so it is mostly for setting up a schema.

```ts
await db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS users_name ON users (name);
`);
```

For anything you need to run more than once, reach for migrations (`bunny db migrations`) instead.

### Errors

Everything throws `DatabaseError`:

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

| Property     | Description                                                                          |
| ------------ | ------------------------------------------------------------------------------------ |
| `message`    | The server's message, or a description of the local validation failure.              |
| `code`       | SQLite code (`SQLITE_CONSTRAINT`), or a client code (`UNAUTHORIZED`, `URL_MISSING`). |
| `status`     | HTTP status, when the failure came from the transport rather than from SQL.          |
| `batchIndex` | Position of the failing statement, when one of your statements in `batch()` failed.  |

Failures that happen before any SQL runs are wrapped too, so a single `catch (error) { if (error instanceof DatabaseError) ... }` covers the whole surface rather than letting a `TypeError` through:

| `code`     | Cause                                                                |
| ---------- | -------------------------------------------------------------------- |
| `NETWORK`  | DNS, TLS, connection refused, or a response that isn't JSON.         |
| `TIMEOUT`  | The `timeout` deadline elapsed.                                      |
| `ABORTED`  | The `signal` you passed was aborted.                                 |
| `PROTOCOL` | The server answered 200 with a body that is not a pipeline response. |

For these three, `error.cause` holds the runtime's original error.

## Types

Integers come back as `number` while they fit exactly, and as `bigint` beyond `Number.MAX_SAFE_INTEGER`. The client never rounds a value to make it fit.

| SQLite  | JavaScript                      |
| ------- | ------------------------------- |
| NULL    | `null`                          |
| INTEGER | `number`, or `bigint` past 2^53 |
| REAL    | `number`                        |
| TEXT    | `string`                        |
| BLOB    | `Uint8Array`                    |

SQLite has no boolean type. `bind(true)` stores `1`, and reads back as `1`.

Rows are typed as `Record<string, SqlValue>` by default. Pass your own shape to skip the cast:

```ts
interface User {
  id: number;
  name: string;
}

const users = await db.prepare("SELECT id, name FROM users").all<User>();
```

Or type the statement once and let every execution of it inherit the shape:

```ts
const byId = db.prepare<User>("SELECT id, name FROM users WHERE id = ?");

const alice = await byId.bind(1).first(); // User | null
const both = await byId.bind(1).all(); // User[]
```

A type argument on the executor still wins over the statement's, so `all<Row>()` on a `Statement<User>` gives you rows back untyped.

That type is an assertion. Nothing validates the rows against it at runtime, so it is only ever as accurate as your SQL.

## Edge Scripting

Edge Scripting runs Deno, so you can import straight from npm. A standalone script serves requests through the Edge Scripting SDK:

```ts
import * as BunnySDK from "npm:@bunny.net/edgescript-sdk@0.12.1";
import { connect } from "npm:@bunny.net/database-client";

const db = connect();

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  const users = await db.prepare("SELECT id, name FROM users LIMIT 10").all();
  return Response.json(users);
});
```

Building the client at module scope is fine. `connect()` opens no socket and does no I/O, so there is nothing to warm up or tear down per request.

An Edge Script is also the right place to hold a database token. The code and its environment stay on Bunny's edge, and the browser only ever sees the response you chose to return.

## Security

### Why not the browser

The client only uses `fetch`, so it would happily run in a browser. It still should not go there.

A database auth token authorizes the connection, which means anything holding it can run whatever SQL that token allows against any table. In client-side code the token shows up in the network tab, in the JS bundle, in `localStorage`, and to any injected script. Once it leaks, a visitor can do everything you can, `DROP TABLE` included.

Worth knowing: `bunny db tokens create` defaults to full access with no expiry, so the token you are most likely to have lying around is also the worst one to lose.

Read-only tokens narrow the damage without fixing it:

```bash
bunny db tokens create --read-only --expiry 30d
```

That still hands over every row of every table, because the token authorizes the connection rather than the query, and SQLite has no row-level security to fall back on.

### What to do instead

Keep the token on your server and expose only the queries you actually want to allow. Usually that means an Edge Script sitting in front of the database:

```ts
// Edge Script: the token stays here, the browser gets only this shape.
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

The browser calls your endpoint, and your endpoint decides what SQL runs.

### Handling tokens

- Keep tokens in environment variables rather than in source. `connect()` reads `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN`, so a token never has to appear in code at all.
- Credentials in the connection URL are rejected, because URLs end up in logs, referrers, and error reports. Pass `authToken` instead.
- Prefer short-lived tokens (`bunny db tokens create --expiry 12h`) and the narrowest authorization that works. If one does leak, `bunny db tokens invalidate` revokes every token for the database.
- `DatabaseError` carries the server's message and SQLite code, so passing one straight back to a client can leak schema details. Log it and return something generic.

## Development

```bash
bun test
```

`scripts/smoke.ts` runs the client against a real database on both runtimes. It creates and drops its own tables, and leaves nothing behind:

```bash
bun run scripts/smoke.ts
deno run --env-file=.env --allow-net --allow-env scripts/smoke.ts
```
