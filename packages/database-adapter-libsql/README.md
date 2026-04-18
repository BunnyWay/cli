# @bunny.net/database-adapter-libsql

Bunny Database adapter for `@bunny.net/database-rest`. Provides a `DatabaseExecutor` implementation and database introspection for libSQL databases.

## Install

```bash
bun add @bunny.net/database-adapter-libsql
```

## Usage

```ts
import { createClient } from "@libsql/client";
import { createLibSQLExecutor, introspect } from "@bunny.net/database-adapter-libsql";
import { createRestHandler } from "@bunny.net/database-rest";

const client = createClient({
  url: "libsql://your-db.lite.bunnydb.net",
  authToken: "your-token",
});

const schema = await introspect({ client });
const executor = createLibSQLExecutor(client);
const handler = createRestHandler(executor, schema);

Bun.serve({ port: 8080, fetch: handler });
```

## API

### `createLibSQLExecutor(client): DatabaseExecutor`

Wraps a `@libsql/client` `Client` as a `DatabaseExecutor` for use with `createRestHandler`.

```ts
import { createClient } from "@libsql/client";
import { createLibSQLExecutor } from "@bunny.net/database-adapter-libsql";

const client = createClient({ url: ":memory:" });
const executor = createLibSQLExecutor(client);
```

### `introspect({ client, version? }): Promise<DatabaseSchema>`

Connects to a libSQL database, runs `PRAGMA table_info` / `PRAGMA foreign_key_list` for each table, and returns a `DatabaseSchema` object (from `@bunny.net/database-openapi`).

Filters out internal tables (`sqlite_*`, `_litestream_*`, `libsql_*`).

```ts
const schema = await introspect({ client });

// With a custom version
const schema = await introspect({ client, version: "2.0.0" });
```
