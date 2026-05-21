# @bunny.net/database-shell

Standalone, framework-agnostic interactive SQL shell for libSQL databases. Provides a readline-based REPL, dot-commands, multiple output formats, sensitive column masking, and persistent history.

Also powers `bunny db shell` in the [bunny.net CLI](https://www.npmjs.com/package/@bunny.net/cli).

## Quick Start

```bash
npm install -g @bunny.net/database-shell
bsql libsql://<your-database>.lite.bunnydb.net --token ey...
```

## CLI Usage

```bash
# Interactive shell
bsql <url> [--token <token>]

# Execute a query and exit
bsql <url> --token <token> "SELECT * FROM users"

# Execute a SQL file
bsql <url> --token <token> seed.sql

# Change output mode
bsql <url> --token <token> "SELECT * FROM users" --mode json

# Show sensitive columns unmasked
bsql <url> --token <token> --unmask
```

| Flag              | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `--token <token>` | Auth token for the database                                           |
| `--mode <mode>`   | Output mode: `default`, `table`, `json`, `csv`, `markdown`            |
| `--unmask`        | Show sensitive column values unmasked                                 |
| `--timing`        | Show query execution timing                                           |
| `--views-dir`     | Directory for saved views (default: `~/.config/bunny/views/<db-id>/`) |
| `--help`          | Show help                                                             |

## Library Usage

### Installation

```bash
npm add @bunny.net/database-shell
```

### Interactive Shell

```typescript
import { createClient } from "@libsql/client";
import { startShell } from "@bunny.net/database-shell";

const client = createClient({
  url: "libsql://...",
  authToken: "...",
});

await startShell({ client });
```

### Execute a Query

```typescript
import { createClient } from "@libsql/client";
import { executeQuery } from "@bunny.net/database-shell";

const client = createClient({
  url: "libsql://...",
  authToken: "...",
});

await executeQuery(client, "SELECT * FROM users", { mode: "json" });
```

### Execute a SQL File

```typescript
import { createClient } from "@libsql/client";
import { executeFile } from "@bunny.net/database-shell";

const client = createClient({
  url: "libsql://...",
  authToken: "...",
});

await executeFile(client, "seed.sql");
```

## Options

### `ShellOptions` (interactive mode)

```typescript
interface ShellOptions {
  client: Client; // @libsql/client instance
  mode?: PrintMode; // Output mode (default: "default")
  masked?: boolean; // Mask sensitive columns (default: true)
  timing?: boolean; // Show query timing (default: false)
  logger?: ShellLogger; // Custom logger (default: console)
  databaseId?: string; // Scope saved views per database
  viewsDir?: string; // Override views storage directory
}
```

### `ExecuteOptions` (non-interactive)

```typescript
interface ExecuteOptions {
  mode?: PrintMode;
  masked?: boolean;
  timing?: boolean;
  logger?: ShellLogger;
}
```

### `ShellLogger`

Inject a custom logger to control output:

```typescript
interface ShellLogger {
  log(msg?: string): void;
  error(msg: string): void;
  warn(msg: string): void;
  dim(msg: string): void;
  success(msg: string): void;
}
```

## Output Modes

| Mode       | Description                   |
| ---------- | ----------------------------- |
| `default`  | Borderless table with headers |
| `table`    | Bordered ASCII table          |
| `json`     | JSON array of row objects     |
| `csv`      | Comma-separated values        |
| `markdown` | GitHub-flavored pipe table    |

## Dot-Commands

Available in interactive mode:

| Command            | Description                         |
| ------------------ | ----------------------------------- |
| `.tables`          | List all tables                     |
| `.describe TABLE`  | Show column details                 |
| `.schema [TABLE]`  | Show CREATE statements              |
| `.indexes [TABLE]` | List indexes                        |
| `.fk TABLE`        | Show foreign keys for a table       |
| `.er`              | Show entity-relationship overview   |
| `.count TABLE`     | Count rows                          |
| `.size TABLE`      | Show table stats                    |
| `.truncate TABLE`  | Delete all rows from a table        |
| `.dump [TABLE]`    | Dump schema and data as SQL         |
| `.read FILE`       | Execute SQL from a file             |
| `.mode [MODE]`     | Set output mode                     |
| `.timing`          | Toggle query timing                 |
| `.mask`            | Enable sensitive column masking     |
| `.unmask`          | Disable sensitive column masking    |
| `.save NAME`       | Save the last query as a named view |
| `.view NAME`       | Execute a saved view                |
| `.views`           | List all saved views                |
| `.unsave NAME`     | Delete a saved view                 |
| `.clear-history`   | Clear command history               |
| `.help`            | Show available commands             |
| `.quit` / `.exit`  | Exit the shell                      |

## Saved Views

Save frequently used queries as named views so you can recall them later. Views are scoped per database and stored as plain `.sql` files in `~/.config/bunny/views/<databaseId>/` (respects `XDG_CONFIG_HOME`).

```sql
→  SELECT name, count(*) as orders FROM users JOIN orders USING (user_id) GROUP BY name ORDER BY orders DESC LIMIT 10;

  name    orders
  Alice   42
  Bob     31
  ...

→  .save top-customers

✓ View "top-customers" saved.

→  .views

  top-customers  — SELECT name, count(*) as orders FROM users JOIN or...

→  .view top-customers

  SELECT name, count(*) as orders FROM users JOIN orders USING (user_id) GROUP BY name ORDER BY orders DESC LIMIT 10
  name    orders
  Alice   42
  Bob     31
  ...

→  .unsave top-customers

✓ View "top-customers" deleted.
```

To enable views, pass a `databaseId` when starting the shell:

```typescript
await startShell({
  client,
  databaseId: "db_01ABC",
});
```

You can also override the storage directory:

```typescript
await startShell({
  client,
  viewsDir: "/path/to/my/views",
});
```

## Sensitive Column Masking

Columns matching patterns like `password`, `secret`, `api_key`, `auth_token`, `ssn`, etc. are masked by default (`********`). Email columns are partially masked (`a****e@example.com`). Toggle with `.mask` / `.unmask` in interactive mode, or pass `masked: false` in options.
