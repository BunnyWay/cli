# @bunny.net/cli

Command-line interface for [bunny.net](https://bunny.net) — manage databases, Edge Scripts, and more from your terminal.

## Installation

```bash
bun install
bun link
```

This makes the `bunny` command available globally.

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

Most `db` commands accept an optional `<database-id>` positional argument. When omitted, the CLI walks up the directory tree looking for a `.env` file containing `BUNNY_DATABASE_URL` and matches it against your database list to auto-detect the database.

For `db shell`, the CLI also reads `BUNNY_DATABASE_AUTH_TOKEN` from `.env` to skip token generation. Both variables can be set by `db quickstart`.

#### `bunny db create`

Create a new database. Interactively prompts for name and region selection (automatic, single region, or manual) when flags are omitted.

```bash
# Interactive — prompts for name and region mode
bunny db create

# Single region
bunny db create --name mydb --primary FR

# Multi-region with replicas
bunny db create --name mydb --primary FR,DE --replicas UK,NY
```

| Flag               | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `--name`           | Database name                                             |
| `--primary`        | Comma-separated primary region IDs (e.g. `FR` or `FR,DE`) |
| `--replicas`       | Comma-separated replica region IDs (e.g. `UK,NY`)         |
| `--storage-region` | Override auto-detected storage region                     |

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

#### `bunny db delete`

Permanently delete a database. Requires double confirmation (or `--force` to skip).

```bash
bunny db delete <database-id>
bunny db delete --force
```

| Flag      | Description              |
| --------- | ------------------------ |
| `--force` | Skip confirmation prompts |

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
| `.count TABLE`     | Count rows in a table                     |
| `.size TABLE`      | Show table stats (rows, columns, indexes) |
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

### `bunny apps`

Manage apps (Magic Containers). Apps are multi-container deployments where all containers share a localhost network. Configuration is stored in a `bunny.jsonc` file which is committed to your repo. The app ID is written back to the config on first deploy, so cloning the repo gives you everything you need. The JSONC format supports a `$schema` property for editor autocompletion.

```bash
# Scaffold a new bunny.jsonc (interactive)
bunny apps init

# Deploy (creates the app on first run, builds from Dockerfile if configured)
bunny apps deploy

# Deploy a pre-built image
bunny apps deploy --image ghcr.io/myorg/api:v1.2

# Sync remote config to local bunny.jsonc
bunny apps pull

# Apply local bunny.jsonc changes to remote
bunny apps push
```

#### `bunny apps init`

Scaffold a new `bunny.jsonc` config file. Prompts for name and regions. If a `Dockerfile` is detected in the current directory, offers to use it for build-and-deploy and prompts for a container registry. Otherwise prompts for a container image.

```bash
bunny apps init
bunny apps init --name my-api --image nginx:latest
```

| Flag      | Description                           |
| --------- | ------------------------------------- |
| `--name`  | App name (defaults to directory name) |
| `--image` | Primary container image               |

#### `bunny apps list`

List all apps.

```bash
bunny apps list
bunny apps ls --output json
```

#### `bunny apps show`

Show app details including status, regions, scaling, cost, and containers.

```bash
bunny apps show
bunny apps show --id <app-id>
```

#### `bunny apps deploy`

Deploy an app. If `bunny.jsonc` has no `id`, the app is created on Bunny first. If `dockerfile` is set in the primary container config (first entry in `containers`), the image is built and pushed automatically (prompts for a registry if not configured). Use `--image` to skip the build and deploy a pre-built image.

```bash
# Build from Dockerfile + deploy
bunny apps deploy

# Deploy a pre-built image
bunny apps deploy --image ghcr.io/myorg/api:v1.2
```

| Flag      | Description                                        |
| --------- | -------------------------------------------------- |
| `--image` | Container image to deploy (skips Dockerfile build) |

#### `bunny apps pull` / `bunny apps push`

Sync configuration between the remote API and local `bunny.jsonc`.

```bash
# Pull remote state to local bunny.jsonc
bunny apps pull
bunny apps pull --force

# Push local bunny.jsonc to remote
bunny apps push
bunny apps push --dry-run
```

#### `bunny apps env`

Manage environment variables per container.

```bash
# List vars (primary container)
bunny apps env list

# Set a variable on a specific container
bunny apps env set DATABASE_URL postgres://localhost:5432/mydb --container postgres

# Remove a variable
bunny apps env remove OLD_VAR

# Pull remote vars to .env
bunny apps env pull
```

| Flag          | Description                         |
| ------------- | ----------------------------------- |
| `--container` | Target container (default: primary) |

#### `bunny apps endpoints`

Manage endpoints (CDN or Anycast) per container.

```bash
bunny apps endpoints list
bunny apps endpoints add --type cdn --ssl --container-port 3000 --public-port 443
bunny apps endpoints remove <endpoint-id>
```

#### `bunny apps volumes`

Manage persistent volumes.

```bash
bunny apps volumes list
bunny apps volumes remove <volume-id> --force
```

#### `bunny apps regions`

View available regions and app region settings.

```bash
bunny apps regions list
bunny apps regions show
```

### `bunny registry`

Manage container registries.

```bash
bunny registry list
bunny registry add --name "GitHub" --username myorg
bunny registry remove <registry-id>
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

## Development

This is a Bun workspace monorepo with four packages. See each package's README for details:

- [`packages/api/`](packages/api/) (`@bunny.net/api`) — standalone API client SDK
- [`packages/app-config/`](packages/app-config/) (`@bunny.net/app-config`) — shared app config schemas, types, and JSON Schema
- [`packages/database-shell/`](packages/database-shell/) (`@bunny.net/database-shell`) — standalone interactive SQL shell
- [`packages/cli/`](packages/cli/) (`@bunny.net/cli`) — the CLI

```bash
# Run directly
bun run packages/cli/src/index.ts <command>

# Watch mode
bun --watch packages/cli/src/index.ts

# Type check
bun run typecheck

# Run tests
bun test

# Build standalone executable
bun run build

# Update OpenAPI specs and regenerate types
bun run api:update
```
