# Database Commands

All database commands live under `bunny db`. Most accept an optional `DB_ID` positional argument. When omitted, the ID is resolved in this order:

1. Explicit `DB_ID` argument
2. `.bunny/database.json` manifest (written by `bunny db link` or accepted during `bunny db create`)
3. `BUNNY_DATABASE_URL` in `.env` (walked up from the current directory and matched against your database list)
4. Interactive prompt

Commands that show a "from ..." hint (e.g. `db delete`, `db tokens create`, `db tokens invalidate`, `db usage`) report which source resolved the ID so you can spot the wrong target before acting.

## `bunny db list` — List all databases

```bash
bunny db list                    # table format
bunny db ls                      # alias
bunny db list --output json      # JSON format
```

Fetches all databases with pagination, live metrics, and region configuration. Displays: ID, Name, Status (Active/Idle), Primary Region, Size.

---

## `bunny db create` — Create a new database

```bash
bunny db create                                                                   # interactive mode
bunny db create --name my-app --primary FR,DE                                     # non-interactive
bunny db create --name my-app --primary FR --replicas UK                          # with replicas
bunny db create --name my-app --primary FR --output json                          # JSON output (no follow-ups)
bunny db create --name my-app --primary FR --link --token --save-env --output json # fully non-interactive (CI)
```

### Flags

| Flag               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--name`           | Database name (prompted if omitted)                                                      |
| `--primary`        | Comma-separated primary region IDs (e.g., `FR,DE`)                                       |
| `--replicas`       | Comma-separated replica region IDs (e.g., `UK,NY`)                                       |
| `--storage-region` | Override auto-detected storage region                                                    |
| `--link`           | Link the current directory to the new database (skips prompt). Use `--no-link` to skip.  |
| `--token`          | Generate a full-access auth token (skips prompt). Use `--no-token` to skip.              |
| `--save-env`       | Save `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` to `.env`. Requires `--token`. |

### Interactive mode

When `--name` and `--primary` are not both provided, the command enters interactive mode:

1. Prompts for database name
2. Fetches available regions and offers three selection modes:
   - **Automatic** — detects optimal regions via CDN probe
   - **Single region** — probes for one optimal region
   - **Manual** — multi-select chooser grouped by continent
3. Creates the database
4. Offers to link the current directory (writes `.bunny/database.json`). If a link already exists for another database, the prompt notes what will be replaced.
5. Offers to generate an auth token
6. Offers to save `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` to `.env`

For each of the three follow-up prompts (link, token, save-env), the matching flag overrides the prompt — `--link`/`--no-link`, `--token`/`--no-token`, `--save-env`/`--no-save-env`.

### Non-interactive mode (`--output json`)

In `--output json` mode, prompts are suppressed entirely — flags are the only way to opt in to linking, token creation, and `.env` writes. The JSON output gains `linked`, `token`, and `saved_to_env` fields reflecting what happened:

```json
{
  "db_id": "db_01KCHBG8C5KSFGG0VRNFQ7EK7X",
  "name": "my-app",
  "url": "libsql://...bunnydb.net/",
  "linked": true,
  "token": "ey...",
  "saved_to_env": true
}
```

`token` is `null` when `--token` was not passed (or `--no-token` was). `saved_to_env` is always `false` without a token.

---

## `bunny db show` — Display database details

```bash
bunny db show                                        # auto-detect from .env
bunny db show db_01KCHBG8C5KSFGG0VRNFQ7EK7X         # explicit ID
bunny db show --output json
```

Displays: ID, Name, URL, Status (Active/Idle), Size (with progress bar), Storage Region, Primary Regions, Replica Regions.

---

## `bunny db link` — Link the current directory to a database

```bash
bunny db link                                        # interactive selection
bunny db link db_01KCHBG8C5KSFGG0VRNFQ7EK7X         # explicit ID
bunny db link --output json
```

Writes `{ id, name }` to `.bunny/database.json` so subsequent `db` commands resolve the target without `BUNNY_DATABASE_URL` in `.env`. The manifest is gitignored — it's per-developer state, not shared.

`bunny db create` offers to write this for the new database. `bunny db delete` removes it automatically when it points at the deleted database.

---

## `bunny db delete` — Delete a database

```bash
bunny db delete db_01KCHBG8C5KSFGG0VRNFQ7EK7X       # with confirmation
bunny db delete --force                               # skip all prompts
bunny db delete --force --output json
```

### Flags

| Flag      | Short | Default | Description               |
| --------- | ----- | ------- | ------------------------- |
| `--force` | `-f`  | `false` | Skip confirmation prompts |

### Confirmation flow

1. First prompt: "Delete database [name] ([id])? This cannot be undone."
2. Second prompt: Type the database name to verify (skipped with `--force`)
3. After deletion: removes `.bunny/database.json` automatically when it points at the deleted database (silent — a manifest pointing at a deleted DB is unambiguously stale), then offers to clean up `.env` references

---

## `bunny db usage` — Display usage statistics

```bash
bunny db usage                                       # current month
bunny db usage --period 7d                           # last 7 days
bunny db usage --period 24h                          # last 24 hours
bunny db usage --from 2026-01-01 --to 2026-01-31    # custom range
bunny db usage --output json
```

### Flags

| Flag       | Default      | Description                                  |
| ---------- | ------------ | -------------------------------------------- |
| `--from`   |              | Start date (ISO date or date-time)           |
| `--to`     |              | End date (ISO date or date-time)             |
| `--period` | `this-month` | Time range: `24h`, `7d`, `30d`, `this-month` |

Displays: Rows read, Rows written, Queries, Avg latency (ms), Storage (with progress bar).

---

## `bunny db shell` — Interactive SQL REPL

```bash
bunny db shell                                       # interactive REPL
bunny db shell db_01KCHBG8C5KSFGG0VRNFQ7EK7X        # specific database
bunny db shell -e "SELECT * FROM users LIMIT 10"    # execute and exit
bunny db shell -e query.sql                          # execute .sql file
bunny db shell --mode json                           # JSON output
bunny db shell --unmask                              # show sensitive values
bunny db shell --url libsql://... --token ey...      # explicit credentials
```

### Flags

| Flag          | Short | Default                          | Description                                                  |
| ------------- | ----- | -------------------------------- | ------------------------------------------------------------ |
| `--execute`   | `-e`  |                                  | SQL statement (or `.sql` file) to execute and exit           |
| `--mode`      | `-m`  | `default`                        | Output format: `default`, `table`, `json`, `csv`, `markdown` |
| `--unmask`    |       | `false`                          | Show sensitive column values unmasked                        |
| `--url`       |       |                                  | Explicit database URL (skips API lookup)                     |
| `--token`     |       |                                  | Explicit auth token (skips token generation)                 |
| `--views-dir` |       | `~/.config/bunny/views/<db-id>/` | Directory for saved SQL views                                |

### Credential resolution order

1. `--url` / `--token` flags
2. `BUNNY_DATABASE_URL` / `BUNNY_DATABASE_AUTH_TOKEN` from `.env`
3. API lookup (fetches URL and generates a temporary token)

### REPL dot-commands

In interactive mode, the shell supports dot-commands like `.tables`, `.schema`, `.fk`, etc.

---

## `bunny db studio` — Read-only table viewer

```bash
bunny db studio                                      # auto-detect database
bunny db studio db_01KCHBG8C5KSFGG0VRNFQ7EK7X       # specific database
bunny db studio --port 3000                          # custom port
bunny db studio --no-open                            # don't auto-open browser
bunny db studio --url libsql://... --token ey...     # explicit credentials
```

| Flag        | Default | Description                                     |
| ----------- | ------- | ----------------------------------------------- |
| `--port`    | `4488`  | Port for the local studio server                |
| `--url`     |         | Database URL (skips API lookup)                 |
| `--token`   |         | Auth token (skips token generation)             |
| `--no-open` | `false` | Don't automatically open the browser            |

Spins up a local server, generates a short-lived auth token if needed, and opens a browser-based read-only table viewer. Long-running until interrupted (Ctrl+C). Credential resolution mirrors `db shell`: `--url`/`--token` flags > `.env` vars > API lookup.

---

## `bunny db quickstart` — Language-specific getting-started guide

```bash
bunny db quickstart                                  # interactive language selection
bunny db quickstart --lang typescript
bunny db quickstart --lang go
bunny db quickstart --lang rust
bunny db quickstart --lang dotnet
```

### Flags

| Flag      | Short | Description                                    |
| --------- | ----- | ---------------------------------------------- |
| `--lang`  | `-l`  | Language: `typescript`, `go`, `rust`, `dotnet` |
| `--url`   |       | Database URL (skips API lookup)                |
| `--token` |       | Auth token (skips token generation)            |

Displays step-by-step instructions: environment variables, install command, and a ready-to-use code snippet.

---

## Regions

### `bunny db regions list` — List configured regions

```bash
bunny db regions list                                # auto-detect from .env
bunny db regions ls                                  # alias
bunny db regions list --output json
```

Displays primary and replica regions with Type, Name, and ID.

### `bunny db regions add` — Add regions

```bash
bunny db regions add                                 # interactive multi-select
bunny db regions add --primary FR,DE
bunny db regions add --replicas UK,NY
bunny db regions add --primary FR --replicas UK
```

| Flag         | Description                               |
| ------------ | ----------------------------------------- |
| `--primary`  | Comma-separated primary region IDs to add |
| `--replicas` | Comma-separated replica region IDs to add |

### `bunny db regions remove` — Remove regions

```bash
bunny db regions remove                              # interactive multi-select
bunny db regions rm                                  # alias
bunny db regions remove --primary FR,DE
bunny db regions remove --replicas UK --force
```

| Flag         | Short | Default | Description                                  |
| ------------ | ----- | ------- | -------------------------------------------- |
| `--primary`  |       |         | Comma-separated primary region IDs to remove |
| `--replicas` |       |         | Comma-separated replica region IDs to remove |
| `--force`    |       | `false` | Skip confirmation prompt                     |

**Important**: At least one primary region must remain. The command errors if you try to remove all primary regions.

---

## Tokens

### `bunny db tokens create` — Generate an auth token

```bash
bunny db tokens create                               # full-access, no expiry
bunny db tokens create --read-only --expiry 30d      # read-only, expires in 30 days
bunny db tokens create --no-save                     # don't prompt to save to .env
bunny db tokens create --force --output json
```

| Flag          | Short | Default   | Description                                                |
| ------------- | ----- | --------- | ---------------------------------------------------------- |
| `--read-only` |       | `false`   | Generate read-only token (default: full-access)            |
| `--expiry`    | `-e`  | no expiry | Duration (`30d`, `12h`, `1w`, `1m`, `1y`) or RFC 3339 date |
| `--save`      |       | `true`    | Prompt to save to `.env` (use `--no-save` to skip)         |
| `--force`     | `-f`  | `false`   | Skip confirmation prompts                                  |

After generation, offers to save `BUNNY_DATABASE_AUTH_TOKEN` (and `BUNNY_DATABASE_URL` if missing) to `.env`.

### `bunny db tokens invalidate` — Revoke all tokens

```bash
bunny db tokens invalidate db_01KCHBG8C5KSFGG0VRNFQ7EK7X
bunny db tokens invalidate --force
bunny db tokens invalidate --force --regenerate --save-env
bunny db tokens invalidate --force --output json
```

| Flag           | Short | Default | Description                                                |
| -------------- | ----- | ------- | ---------------------------------------------------------- |
| `--force`      | `-f`  | `false` | Skip confirmation prompts                                  |
| `--regenerate` |       | `false` | Generate a replacement token after invalidation            |
| `--save-env`   |       |         | Save replacement token to `.env` (requires `--regenerate`) |

**This is destructive** — all existing tokens for the database are revoked. After invalidation, the command offers to:

1. Remove stale `BUNNY_DATABASE_AUTH_TOKEN` from `.env`
2. Generate a replacement token
3. Save the new token to `.env`

Use `--force --regenerate --save-env` to do all three without prompts.
