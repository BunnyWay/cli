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
const executor = createLibSQLExecutor({ client });
const handler = createRestHandler(executor, schema);

Bun.serve({ port: 8080, fetch: handler });
```

## API

### `createLibSQLExecutor({ client }): DatabaseExecutor`

Wraps a `@libsql/client` `Client` as a `DatabaseExecutor` for use with `createRestHandler`.

```ts
import { createClient } from "@libsql/client";
import { createLibSQLExecutor } from "@bunny.net/database-adapter-libsql";

const client = createClient({ url: ":memory:" });
const executor = createLibSQLExecutor({ client });
```

### `introspect({ client, version?, exclude?, include? }): Promise<DatabaseSchema>`

Connects to a libSQL database, runs `PRAGMA table_info` / `PRAGMA foreign_key_list` / `PRAGMA index_list` for each table, and returns a `DatabaseSchema` object (from `@bunny.net/database-openapi`).

Always filters out SQLite internals (`sqlite_*`, `_litestream_*`, `libsql_*`). Additionally excludes common migration/framework tables by default.

```ts
const schema = await introspect({ client });

// With a custom version
const schema = await introspect({ client, version: "2.0.0" });

// Show all tables (disable default excludes)
const schema = await introspect({ client, exclude: [] });

// Custom exclude patterns (supports trailing * wildcards)
const schema = await introspect({
  client,
  exclude: ["__*", "_prisma_migrations", "temp_*"],
});

// Only include specific tables
const schema = await introspect({
  client,
  include: ["users", "posts"],
});

// Extend the defaults with additional excludes
import { DEFAULT_EXCLUDE_PATTERNS } from "@bunny.net/database-adapter-libsql";

const schema = await introspect({
  client,
  exclude: [...DEFAULT_EXCLUDE_PATTERNS, "temp_*", "logs"],
});
```

**Default exclude patterns:**

- `__*` (double underscore prefix)
- `_prisma_migrations`
- `_sqlx_migrations`
- `__diesel_schema_migrations`
- `__drizzle_migrations`
- `schema_migrations`
- `ar_internal_metadata`
- `_cf_KV`
