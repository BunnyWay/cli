# @bunny.net/database-openapi

Generate an OpenAPI 3.0 specification from a database schema. Zero dependencies - pass in a schema, get back a spec.

## Install

```bash
bun add @bunny.net/database-openapi
```

## Usage

```ts
import { generateOpenAPISpec } from "@bunny.net/database-openapi";
import type { DatabaseSchema } from "@bunny.net/database-openapi";

const schema: DatabaseSchema = {
  tables: {
    users: {
      name: "users",
      columns: [
        { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
        { name: "name", type: "TEXT", nullable: false, primaryKey: false },
        { name: "email", type: "TEXT", nullable: false, primaryKey: false },
        { name: "age", type: "INTEGER", nullable: true, primaryKey: false },
        {
          name: "created_at",
          type: "DATETIME",
          nullable: false,
          primaryKey: false,
          defaultValue: "CURRENT_TIMESTAMP",
        },
      ],
      primaryKey: ["id"],
      foreignKeys: [],
    },
  },
  version: "1.0.0",
};

const spec = generateOpenAPISpec(schema);
```

This produces a complete OpenAPI 3.0.3 spec with:

**Collection endpoints** (`/{table}`):

- `GET /{table}` - list rows with filtering, sorting, pagination
- `POST /{table}` - insert one or many rows
- `PATCH /{table}` - update rows matching filters
- `DELETE /{table}` - delete rows matching filters

**Single-resource endpoints** (`/{table}/{pk}`) - generated for tables with a single-column primary key:

- `GET /{table}/{pk}` - get one row by primary key
- `PATCH /{table}/{pk}` - update one row by primary key
- `DELETE /{table}/{pk}` - delete one row by primary key

**Unique column lookup endpoints** (`/{table}/by-{column}/{value}`) - generated for columns with a unique index:

- `GET /{table}/by-{column}/{value}` - get one row by unique column
- `PATCH /{table}/by-{column}/{value}` - update one row by unique column
- `DELETE /{table}/by-{column}/{value}` - delete one row by unique column

Tables with composite primary keys or no primary key only get collection endpoints. Compound unique indexes (e.g. `UNIQUE(user_id, role)`) are captured in `indexes` but only single-column unique indexes generate lookup routes.

The generated spec also includes:

- **Three schema variants per table**: `{table}` (responses), `{table}Insert` (excludes auto-increment PKs), `{table}Update` (all non-PK columns optional)
- **Error schema**: `Error` with `message` (required) and `code` (optional), referenced by 400/404 responses
- **Reusable parameters**: `select`, `order`, `limit`, `offset` defined in `components.parameters` and `$ref`'d from GET operations
- **Top-level tags**: one per table with a description, for Swagger UI / Redoc grouping
- **Error responses**: 400 and/or 404 on all operations; single-resource endpoints return 404 when the row doesn't exist

## Options

```ts
const spec = generateOpenAPISpec(schema, {
  title: "My API",
  version: "2.0.0",
  description: "REST API for my database",
});
```

| Option        | Default                                      |
| ------------- | -------------------------------------------- |
| `title`       | `"Database REST API"`                        |
| `version`     | Uses `schema.version`                        |
| `description` | `"Auto-generated REST API for your database"`|

## Examples in the spec

The generator adds `example` values to every column schema. It uses name-aware hinting first, then falls back to type-based defaults:

| Column name pattern                        | Example                            |
| ------------------------------------------ | ---------------------------------- |
| `email`                                    | `"user@example.com"`               |
| `name`                                     | `"John Doe"`                       |
| `first_name`                               | `"John"`                           |
| `last_name`                                | `"Doe"`                            |
| `username`                                 | `"johndoe"`                        |
| `phone`, `mobile`, `tel`                   | `"+1-555-0123"`                    |
| `url`, `website`, `homepage`, `link`       | `"https://example.com"`            |
| `image`, `avatar`, `photo`, `*_url`        | `"https://example.com/image.png"`  |
| `title`, `subject`, `headline`             | `"Hello World"`                    |
| `description`, `summary`, `bio`, `about`   | `"A short description"`            |
| `body`, `content`, `text`, `message`       | `"Lorem ipsum dolor sit amet"`     |
| `slug`                                     | `"hello-world"`                    |
| `price`, `amount`, `cost`, `total`         | `9.99`                             |
| `age`                                      | `25`                               |
| `latitude`                                 | `37.7749`                          |
| `longitude`                                | `-122.4194`                        |
| `*_at`, `*_date`, `*_time`, `*_on`         | `"2024-01-01T00:00:00Z"`           |
| `*_id`                                     | `1`                                |

For unrecognized names, falls back by type:

| Column type | Example                    |
| ----------- | -------------------------- |
| `INTEGER`   | `1`                        |
| `REAL`      | `1.5`                      |
| `BOOLEAN`   | `true`                     |
| `DATETIME`  | `"2024-01-01T00:00:00Z"`   |
| `TEXT`      | `"string"`                 |
| `BLOB`      | _(none)_                   |

## Schema types

```ts
import type {
  DatabaseSchema,
  TableDefinition,
  ColumnDefinition,
  ColumnType,
  ForeignKey,
  IndexDefinition,
  GenerateOptions,
} from "@bunny.net/database-openapi";
```

### `DatabaseSchema`

```ts
interface DatabaseSchema {
  tables: Record<string, TableDefinition>;
  version: string;
  generatedAt?: string;
}
```

### `TableDefinition`

```ts
interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  indexes: IndexDefinition[];
  uniqueColumns: string[];
}
```

### `ColumnDefinition`

```ts
interface ColumnDefinition {
  name: string;
  type: ColumnType; // "INTEGER" | "REAL" | "BOOLEAN" | "DATETIME" | "BLOB" | "TEXT"
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string | number | null;
}
```

### `ForeignKey`

```ts
interface ForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}
```

### `IndexDefinition`

```ts
interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
}
```

## Generating a client SDK

Serve the spec from an endpoint, then use `openapi-typescript` to generate types:

```bash
npx openapi-typescript http://localhost:8080/ -o ./schema.d.ts
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./schema";

const client = createClient<paths>({ baseUrl: "http://localhost:8080" });

const { data } = await client.GET("/users", {
  params: { query: { select: "id,name", limit: 10 } },
});
```
