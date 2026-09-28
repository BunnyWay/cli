# @bunny.net/database-adapter

Bunny Database adapter for `@bunny.net/database-rest`. Provides a `DatabaseExecutor` implementation and database introspection.

## Install

```bash
bun add @bunny.net/database-adapter
```

## Usage

```ts
import { connect } from "@bunny.net/database-client";
import { createExecutor, introspect } from "@bunny.net/database-adapter";
import { createRestHandler } from "@bunny.net/database-rest";

const client = connect({
  url: "libsql://01KCHBG8C5KSFGG0VRNFQ7EK7X-my-app.lite.bunnydb.net",
  authToken: "your-token",
});

const schema = await introspect({ client });
const executor = createExecutor({ client });
const handler = createRestHandler(executor, schema);

Bun.serve({ port: 8080, fetch: handler });
```

## API

### `createExecutor({ client }): DatabaseExecutor`

Wraps a connection as a `DatabaseExecutor` for use with `createRestHandler`. `client` is anything matching `AdapterClient`, which `Database` from `@bunny.net/database-client` satisfies.

```ts
import { connect } from "@bunny.net/database-client";
import { createExecutor } from "@bunny.net/database-adapter";

const executor = createExecutor({ client: connect() });
```

For local development and tests, `@bunny.net/database-adapter/sqlite` backs the same surface with `bun:sqlite`:

```ts
import { Database } from "bun:sqlite";
import { sqliteClient } from "@bunny.net/database-adapter/sqlite";

const executor = createExecutor({ client: sqliteClient(new Database(":memory:")) });
```

### `introspect({ client, version?, exclude?, include? }): Promise<DatabaseSchema>`

Connects to a database, runs `PRAGMA table_info` / `PRAGMA foreign_key_list` / `PRAGMA index_list` for each table, and returns a `DatabaseSchema` object (from `@bunny.net/database-openapi`).

Always filters out SQLite internals (`sqlite_*`, `_litestream_*`, `libsql_*`). Additionally excludes common migration/framework tables by default.

```ts
const schema = await introspect({ client });

// With a custom version
const schema = await introspect({
  client,
  version: "2.0.0",
});

// Show all tables (disable default excludes)
const schema = await introspect({
  client,
  exclude: [],
});

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
import { DEFAULT_EXCLUDE_PATTERNS } from "@bunny.net/database-adapter";

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
