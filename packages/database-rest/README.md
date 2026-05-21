# @bunny.net/database-rest

A PostgREST-like REST API handler for databases. Serves a full CRUD API with filtering, sorting, pagination, and an OpenAPI spec at the root endpoint. Database-agnostic - bring your own adapter.

## Install

```bash
bun add @bunny.net/database-rest
```

## Quick start

> ⚠️ `createRestHandler` does not authenticate requests. It is a CRUD
> handler factory, not a server. **Always wrap it in an auth check before
> exposing it to a network.** This package ships `requireAuth()` for the
> common shared-token case; bring your own for anything more involved.

```ts
import { createClient } from "@libsql/client";
import { createLibSQLExecutor, introspect } from "@bunny.net/database-adapter-libsql";
import { createRestHandler, requireAuth } from "@bunny.net/database-rest";

const client = createClient({ url: ":memory:" });

await client.executeMultiple(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
  INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');
`);

const schema = await introspect({ client });
const executor = createLibSQLExecutor({ client });
const handler = createRestHandler(executor, schema);

const token = process.env.API_TOKEN ?? crypto.randomUUID();
const guarded = requireAuth(handler, { token });

Bun.serve({
  port: 8080,
  hostname: "127.0.0.1",
  fetch: guarded,
});
```

Requests must then carry `Authorization: Bearer <token>`. See
[`requireAuth()`](#requireauthhandler-options) for the full signature
(cookies, public routes).

## Architecture

`database-rest` is database-agnostic. It generates SQL and expects an executor to run it:

```
database-openapi          - schema types + OpenAPI spec generation
database-rest             - routing, query parsing, SQL building, handler
database-adapter-libsql   - executor + introspection for Bunny Database (libSQL)
```

The `DatabaseExecutor` interface is simple:

```ts
interface DatabaseExecutor {
  execute(
    sql: string,
    args: (string | number | boolean | null)[],
  ): Promise<{
    columns: string[];
    rows: Record<string, unknown>[];
  }>;
}
```

Any database that can run parameterized SQL and return rows can implement this.

## API

### `createRestHandler(executor, schema, options?): (req: Request) => Promise<Response>`

Returns a standard `Request -> Response` handler. Works with `Bun.serve`, Edge Scripts, or any framework that uses the Web API `Request`/`Response` types.

```ts
const handler = createRestHandler(executor, schema, {
  basePath: "/api",
  openapi: {
    title: "My API",
    version: "1.0.0",
  },
});

Bun.serve({ port: 8080, fetch: handler });
```

#### Options

| Option                | Type     | Default               | Description                                       |
| --------------------- | -------- | --------------------- | ------------------------------------------------- |
| `basePath`            | `string` | `""`                  | Path prefix to strip before routing (e.g. `/api`) |
| `openapi.title`       | `string` | `"Database REST API"` | Title in the OpenAPI spec                         |
| `openapi.version`     | `string` | `schema.version`      | Version in the OpenAPI spec                       |
| `openapi.description` | `string` | auto-generated        | Description in the OpenAPI spec                   |

### `requireAuth(handler, options): (req: Request) => Promise<Response>`

Wraps any request handler with a shared-token check. Validates
`Authorization: Bearer <token>` using a timing-safe comparison and
optionally accepts the token via a named cookie. Returns `401` with
`WWW-Authenticate: Bearer realm="database-rest"` on failure.

```ts
const guarded = requireAuth(handler, {
  token: process.env.API_TOKEN!,
  cookieName: "session", // optional: also accept token in cookie
  isPublic: (p) => p === "/auth", // optional: pathnames to skip auth on
});
```

#### Options

| Option       | Type                            | Default    | Description                                           |
| ------------ | ------------------------------- | ---------- | ----------------------------------------------------- |
| `token`      | `string`                        | (required) | Shared secret the request must present.               |
| `cookieName` | `string`                        | none       | If set, also accept the token from this cookie.       |
| `isPublic`   | `(pathname: string) => boolean` | none       | Pathnames for which auth is skipped (e.g. handshake). |

#### Bringing your own auth

`requireAuth` covers the shared-token case. For richer auth (Clerk,
Auth0, JWT verification, per-row scopes), wrap `createRestHandler`'s
result yourself; it returns a standard Web `Request → Response` handler,
so any check that fits in a `fetch` wrapper works:

```ts
const handler = createRestHandler(executor, schema);

Bun.serve({
  fetch: async (req) => {
    const session = await myAuthProvider.authenticate(req);
    if (!session)
      return new Response("Unauthorized", {
        status: 401,
      });
    return handler(req);
  },
});
```

The `requireAuth` API is intentionally shaped to grow a verifier-based
variant (`{ verify: (req) => session | null }`) later without breaking
existing `{ token }` callers. When there's demand, it lands as an
additive widening.

## Endpoints

### OpenAPI spec

```
GET /
```

Returns the full OpenAPI 3.0.3 spec as JSON, generated from the schema via `@bunny.net/database-openapi`.

### Collection endpoints (`/{table}`)

#### List

```
GET /users
GET /users?select=id,name,email
GET /users?select=id,name&limit=10&offset=20
```

Returns `{ data: [...] }` with `X-Total-Count` and `Content-Range` headers.

#### Filter

```
GET /users?status=eq.active
GET /users?age=gte.18
GET /users?name=like.John%25
GET /users?role=in.(admin,moderator)
GET /users?deleted_at=is.null
```

**Operators**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`

#### Order

```
GET /users?order=created_at.desc
GET /users?order=name.asc,id.desc
GET /users?order=name.asc.nullsfirst
```

#### Insert

```bash
# Single row
curl -X POST /users \
  -H "Content-Type: application/json" \
  -d '{"name": "John", "email": "john@example.com"}'

# Multiple rows
curl -X POST /users \
  -H "Content-Type: application/json" \
  -d '[{"name": "John", "email": "john@example.com"}, {"name": "Jane", "email": "jane@example.com"}]'
```

Returns `201` with `{ data: [...] }` containing the inserted rows (with generated IDs).

#### Bulk update

```bash
curl -X PATCH "/users?status=eq.inactive" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}'
```

Filters are **required** - updates without filters return `400` to prevent accidental mass updates.

#### Bulk delete

```bash
curl -X DELETE "/users?status=eq.archived"
```

Filters are **required** - deletes without filters return `400` to prevent accidental mass deletes.

### Single-resource endpoints (`/{table}/{pk}`)

Generated for tables with a single-column primary key. Returns a single object (`{ data: {...} }`) instead of an array.

#### Get by ID

```bash
curl /users/1
curl /users/1?select=id,name
```

Returns `404` if the row doesn't exist.

#### Update by ID

```bash
curl -X PATCH /users/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane"}'
```

Returns `404` if the row doesn't exist.

#### Delete by ID

```bash
curl -X DELETE /users/1
```

Returns `404` if the row doesn't exist.

### Unique column lookup endpoints (`/{table}/by-{column}/{value}`)

Generated for columns with a unique index (excluding the primary key). Supports GET, PATCH, and DELETE.

```bash
# Get by unique column
curl /users/by-email/alice@example.com

# Update by unique column
curl -X PATCH /users/by-email/alice@example.com \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Smith"}'

# Delete by unique column
curl -X DELETE /users/by-email/alice@example.com
```

Returns `404` if the row doesn't exist or if the column isn't a unique index. Compound unique indexes (e.g. `UNIQUE(user_id, role)`) are available in the schema's `indexes` but only single-column unique indexes generate lookup routes.

## Response format

**Collection (list):**

```json
{
  "data": [
    { "id": 1, "name": "John" },
    { "id": 2, "name": "Jane" }
  ]
}
```

**Single resource:**

```json
{
  "data": { "id": 1, "name": "John" }
}
```

**Error:**

```json
{
  "message": "Row not found",
  "code": "NOT_FOUND"
}
```

**Pagination headers** (on collection GET):

| Header          | Example        |
| --------------- | -------------- |
| `X-Total-Count` | `42`           |
| `Content-Range` | `items 0-9/42` |

## Safety

- All queries use **parameterized SQL** - no string interpolation of user input
- Table and column names are quoted with `"identifier"` escaping
- Collection `PATCH` and `DELETE` **require at least one filter** - no accidental mass operations
- Only tables in the schema are routable - unknown table names return `404`
- Single-resource endpoints return `404` when the row doesn't exist

## Generating a client SDK

Use the OpenAPI spec served at `GET /` to generate a type-safe client:

```bash
npx openapi-typescript http://localhost:8080/ -o ./schema.d.ts
bun add openapi-fetch
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./schema";

const client = createClient<paths>({
  baseUrl: "http://localhost:8080",
});

const { data } = await client.GET("/users", {
  params: {
    query: { select: "id,name", limit: 10 },
  },
});
```

## Development

Run the tests:

```bash
bun test
```

A throwaway playground is available under `examples/` for hacking on the
handler with curl. It binds to `127.0.0.1` and serves an in-memory SQLite
seeded with toy data (no auth, not for production):

```bash
bun run example
# or: PORT=3000 bun run example
```
