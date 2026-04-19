# @bunny.net/cli

Command-line interface for [bunny.net](https://bunny.net) — manage databases, apps (Magic Containers), Edge Scripts, and more from your terminal.

## Installation

```bash
# Shell installer (downloads prebuilt binary)
curl -fsSL https://cli.bunny.net/install.sh | sh

# Or via npm
npm install -g @bunny.net/cli
```

## Quick Start

```bash
# Authenticate with your bunny.net account
bunny login

# Or set up a profile with an API key directly
bunny config init --api-key bny_xxxxxxxxxxxx

# List your databases
bunny db list

# Create a new database
bunny db create
```

## Commands

### `bunny login`

Authenticate with bunny.net via the browser.

```bash
# Browser-based OAuth login
bunny login

# Login to a specific profile
bunny login --profile staging

# Overwrite existing profile without prompting
bunny login --force
```

### `bunny logout`

Remove a stored authentication profile.

```bash
bunny logout
bunny logout --force
```

### `bunny whoami`

Show the currently authenticated account, including your name and email.

```bash
bunny whoami
# Logged in as Jamie Barton (jamie@bunny.net) 🐇
# Profile: default

bunny whoami --output json
bunny whoami --profile staging
```

### `bunny config`

Manage CLI configuration and profiles.

```bash
# First-time setup
bunny config init
bunny config init --api-key bny_xxxxxxxxxxxx

# View resolved configuration
bunny config show
bunny config show --output json

# Manage named profiles
bunny config profile create staging
bunny config profile create staging --api-key bny_xxxxxxxxxxxx
bunny config profile delete staging
```

### `bunny db`

Manage databases.

Most `db` commands accept an optional `<database-id>` positional argument. When omitted, the CLI resolves the target in this order:

1. Explicit `<database-id>` argument
2. `.bunny/database.json` manifest written by `bunny db link`
3. `BUNNY_DATABASE_URL` in a `.env` file (walked up from the current directory) matched against your database list
4. Interactive selection prompt

For `db shell`, the CLI also reads `BUNNY_DATABASE_AUTH_TOKEN` from `.env` to skip token generation. Both variables can be set by `db quickstart`.

#### `bunny db create`

Create a new database. Interactively prompts for name and region selection (automatic, single region, or manual) when flags are omitted. After creation, prompts to link the directory, generate an auth token, and save credentials to `.env`.

```bash
# Interactive — prompts for name and region mode
bunny db create

# Single region
bunny db create --name mydb --primary FR

# Multi-region with replicas
bunny db create --name mydb --primary FR,DE --replicas UK,NY

# Fully non-interactive (CI / scripts)
bunny db create --name mydb --primary FR --link --token --save-env --output json
```

| Flag               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--name`           | Database name                                                                            |
| `--primary`        | Comma-separated primary region IDs (e.g. `FR` or `FR,DE`)                                |
| `--replicas`       | Comma-separated replica region IDs (e.g. `UK,NY`)                                        |
| `--storage-region` | Override auto-detected storage region                                                    |
| `--link`           | Link the current directory to the new database (skips prompt). Use `--no-link` to skip.  |
| `--token`          | Generate a full-access auth token (skips prompt). Use `--no-token` to skip.              |
| `--save-env`       | Save `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` to `.env`. Requires `--token`. |

In `--output json` mode, prompts are suppressed entirely — flags are the only way to opt in to linking, token creation, and `.env` writes. The JSON output gains `linked`, `token`, and `saved_to_env` fields reflecting what happened.

#### `bunny db list`

List all databases. Shows ID, name, status, primary region, and size.

```bash
bunny db list
bunny db list --output json
```

#### `bunny db show`

Show details for a single database.

```bash
bunny db show <database-id>
bunny db show
bunny db show --output json
```

#### `bunny db link`

Link the current directory to a database. Saves `{ id, name }` to `.bunny/database.json` so subsequent `db` commands resolve the target without `BUNNY_DATABASE_URL` in `.env`. With no argument, lists all databases for interactive selection.

```bash
# Interactive selection
bunny db link

# Direct link by ID
bunny db link <database-id>
```

`bunny db create` offers to link the new database, and `bunny db delete` removes a stale link automatically when it points at the deleted database.

#### `bunny db delete`

Permanently delete a database. Requires double confirmation (or `--force` to skip).

```bash
bunny db delete <database-id>
bunny db delete --force
```

| Flag      | Description              |
| --------- | ------------------------ |
| `--force` | Skip confirmation prompts |

#### `bunny db regions list`

List configured primary and replica regions for a database.

```bash
bunny db regions list
bunny db regions list <database-id>
```

#### `bunny db regions add`

Add primary or replica regions to a database.

```bash
bunny db regions add --primary FR,DE
bunny db regions add --replicas UK,NY
bunny db regions add --primary FR --replicas UK
```

| Flag         | Description                                     |
| ------------ | ----------------------------------------------- |
| `--primary`  | Comma-separated primary region IDs to add        |
| `--replicas` | Comma-separated replica region IDs to add        |

#### `bunny db regions remove`

Remove primary or replica regions from a database.

```bash
bunny db regions remove --primary FR
bunny db regions remove --replicas UK,NY
```

| Flag         | Description                                     |
| ------------ | ----------------------------------------------- |
| `--primary`  | Comma-separated primary region IDs to remove     |
| `--replicas` | Comma-separated replica region IDs to remove     |

#### `bunny db regions update`

Interactively update region configuration. Shows all available regions with current ones pre-selected — toggle on/off and confirm.

```bash
bunny db regions update
bunny db regions update <database-id>
```

#### `bunny db usage`

Show usage statistics for a database.

```bash
bunny db usage <database-id>
bunny db usage --period 7d
bunny db usage --output json
```

#### `bunny db quickstart`

Generate a quickstart guide for connecting to a database.

```bash
bunny db quickstart
bunny db quickstart <database-id> --lang bun
```

#### `bunny db shell`

Open an interactive SQL shell for a database. Supports multiple output modes, sensitive column masking, persistent history, and a set of dot-commands for quick introspection.

```bash
# Interactive shell (auto-detects database from .env)
bunny db shell

# Specify a database ID
bunny db shell <database-id>

# Execute a query and exit
bunny db shell "SELECT * FROM users"
bunny db shell <database-id> "SELECT * FROM users"
bunny db shell --execute "SELECT COUNT(*) FROM posts"

# Output modes
bunny db shell -m json -e "SELECT * FROM users"
bunny db shell -m csv -e "SELECT * FROM users"
bunny db shell -m markdown -e "SELECT * FROM users"

# Execute a SQL file
bunny db shell -e seed.sql
bunny db shell seed.sql

# Show sensitive columns unmasked
bunny db shell --unmask

# Direct connection (skip API lookup)
bunny db shell --url libsql://... --token ey...
```

| Flag        | Alias | Description                                                |
| ----------- | ----- | ---------------------------------------------------------- |
| `--execute` | `-e`  | Execute a SQL statement and exit                           |
| `--mode`    | `-m`  | Output mode: `default`, `table`, `json`, `csv`, `markdown` |
| `--unmask`  |       | Show sensitive column values unmasked                      |
| `--url`     |       | Database URL (skips API lookup)                            |
| `--token`   |       | Auth token (skips token generation)                        |

**Dot-commands** (available in interactive mode):

| Command            | Description                               |
| ------------------ | ----------------------------------------- |
| `.tables`          | List all tables                           |
| `.describe TABLE`  | Show column details for a table           |
| `.schema [TABLE]`  | Show CREATE statements                    |
| `.indexes [TABLE]` | List indexes                              |
| `.fk TABLE`        | Show foreign keys for a table             |
| `.er`              | Show entity-relationship overview         |
| `.count TABLE`     | Count rows in a table                     |
| `.size TABLE`      | Show table stats (rows, columns, indexes) |
| `.truncate TABLE`  | Delete all rows from a table              |
| `.dump [TABLE]`    | Dump schema and data as SQL               |
| `.read FILE`       | Execute SQL statements from a file        |
| `.mode [MODE]`     | Set output mode                           |
| `.timing`          | Toggle query execution timing             |
| `.mask`            | Enable sensitive column masking           |
| `.unmask`          | Disable sensitive column masking          |
| `.clear-history`   | Clear command history                     |
| `.help`            | Show available commands                   |
| `.quit` / `.exit`  | Exit the shell                            |

**Sensitive column masking**: Columns matching patterns like `password`, `secret`, `api_key`, `auth_token`, `ssn`, etc. are masked by default (`********`). Email columns are partially masked (`a••••e@example.com`). Use `.unmask` or `--unmask` to reveal values.

#### `bunny db tokens create`

Generate an auth token for a database. The database ID can be provided as a positional argument or auto-detected from `BUNNY_DATABASE_URL` in a `.env` file.

```bash
# Provide database ID explicitly
bunny db tokens create <database-id>

# Auto-detect from .env BUNNY_DATABASE_URL
bunny db tokens create

# Read-only token
bunny db tokens create --read-only

# Token with expiry (duration shorthand or RFC 3339)
bunny db tokens create --expiry 30d
bunny db tokens create --expiry 2026-12-31T23:59:59Z
```

| Flag           | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `--read-only`  | Generate a read-only token (default: full access)                         |
| `-e, --expiry` | Token expiry — duration (`30d`, `12h`, `1w`, `1m`, `1y`) or RFC 3339 date |

#### `bunny db tokens invalidate`

Invalidate all auth tokens for a database. Prompts for confirmation unless `--force` is passed.

```bash
bunny db tokens invalidate <database-id>
bunny db tokens invalidate --force
```

### `bunny registries`

Manage container registries. Running `bunny registries` without a subcommand lists all registries.

```bash
bunny registries
bunny registries list
bunny registries add --name "GitHub" --username myorg
bunny registries remove <registry-id>
```

### `bunny scripts`

Manage Edge Scripts.

#### `bunny scripts init`

Create a new Edge Script project from a template.

```bash
# Interactive wizard
bunny scripts init

# Non-interactive with CLI deployment
bunny scripts init --name my-script --type standalone --template Empty --deploy-method cli --deploy

# Non-interactive with GitHub Actions
bunny scripts init --name my-script --type standalone --template Empty --deploy-method github --deploy
```

| Flag              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `--name`          | Project directory name                               |
| `--type`          | Script type: `standalone` or `middleware`             |
| `--template`      | Template name                                        |
| `--deploy-method` | Deployment method: `github` or `cli`                 |
| `--deploy`        | Create script on bunny.net after scaffolding         |
| `--skip-git`      | Skip git initialization (CLI deploy method only)     |
| `--skip-install`  | Skip dependency installation                         |

When choosing **GitHub Actions**, git is initialized automatically, GitHub-specific workflow files are kept, and after creating the script you'll be shown the `SCRIPT_ID` to add as a GitHub repo secret.

When choosing **CLI**, the `.github/` and `.changeset/` directories are removed from the template and git initialization is skipped.

#### `bunny scripts deploy`

Deploy code to an Edge Script. Uploads code and publishes by default.

```bash
# Deploy and publish
bunny scripts deploy dist/index.js

# Deploy without publishing
bunny scripts deploy dist/index.js --skip-publish

# Deploy to a specific script
bunny scripts deploy dist/index.js 12345
```

| Flag              | Description                    |
| ----------------- | ------------------------------ |
| `--skip-publish`  | Upload code without publishing |

> **Note:** `bunny scripts deploy` works regardless of how the script was created or whether GitHub Actions is configured. The last deployment always wins — whether triggered by a GitHub Action or a manual CLI deploy.

#### `bunny scripts link`

Link the current directory to a remote Edge Script. Creates a `.bunny/script.json` manifest file.

```bash
# Interactive — select from list
bunny scripts link

# Non-interactive
bunny scripts link --id <script-id>
```

#### `bunny scripts list`

List all Edge Scripts.

```bash
bunny scripts list
bunny scripts ls
bunny scripts list --output json
```

#### `bunny scripts show`

Show details for an Edge Script. Uses the linked script from `.bunny/script.json` if no ID is provided.

```bash
bunny scripts show <script-id>
bunny scripts show
```

### `bunny api`

Make a raw authenticated HTTP request to any bunny.net API endpoint. Auth is handled automatically via your configured API key.

```bash
# List pull zones
bunny api GET /pullzone

# Get a specific pull zone
bunny api GET /pullzone/12345

# List databases
bunny api GET /database/v2/databases

# Create a database with a JSON body
bunny api POST /database/v2/databases --body '{"name":"test","storage_region":"DE","primary_regions":["DE"]}'

# Delete a DNS zone
bunny api DELETE /dnszone/12345

# Pipe body from stdin
echo '{"name":"test"}' | bunny api POST /database/v2/databases

# Show request/response details
bunny api GET /pullzone --verbose
```

| Flag     | Alias | Description        |
| -------- | ----- | ------------------ |
| `--body` | `-b`  | JSON request body  |

The method is case-insensitive (`get` and `GET` both work). Paths are relative to `https://api.bunny.net` — use `/database/...` for the Database API and `/mc/...` for Magic Containers.

## Global Options

| Flag        | Alias | Description                                                  | Default   |
| ----------- | ----- | ------------------------------------------------------------ | --------- |
| `--profile` | `-p`  | Configuration profile to use                                 | `default` |
| `--verbose` | `-v`  | Enable verbose output                                        | `false`   |
| `--output`  | `-o`  | Output format: `text`, `json`, `table`, `csv`, or `markdown` | `text`    |
| `--api-key` |       | API key (takes priority over profile and environment)        |           |
| `--version` |       | Show version                                                 |           |
| `--help`    |       | Show help                                                    |           |

### Output Formats

| Format     | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `text`     | Human-friendly borderless tables with bold headers (default) |
| `json`     | Structured JSON for scripting and piping                     |
| `table`    | Bordered ASCII table                                         |
| `csv`      | Comma-separated values with proper escaping                  |
| `markdown` | GitHub-flavored pipe tables                                  |

## Environment Variables

| Variable                 | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `BUNNYNET_API_KEY`       | API key (overrides profile-based key)                           |
| `BUNNYNET_API_URL`       | API base URL (default: `https://api.bunny.net`)                 |
| `BUNNYNET_DASHBOARD_URL` | Dashboard URL for auth flow (default: `https://dash.bunny.net`) |
| `NO_COLOR`               | Disable colored output ([no-color.org](https://no-color.org))   |
