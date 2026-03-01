# @bunnynet/cli

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

List all databases.

```bash
bunny db list
bunny db list --output json
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

Manage apps (Magic Containers). Apps are multi-container deployments where all containers share a localhost network. Configuration is stored in a `bunny.toml` file which is committed to your repo. The app ID is written back to the toml on first deploy, so cloning the repo gives you everything you need.

```bash
# Scaffold a new bunny.toml (interactive)
bunny apps init

# Deploy (creates the app on first run, builds from Dockerfile if configured)
bunny apps deploy

# Deploy a pre-built image
bunny apps deploy --image ghcr.io/myorg/api:v1.2

# Sync remote config to local bunny.toml
bunny apps pull

# Apply local bunny.toml changes to remote
bunny apps push
```

#### `bunny apps init`

Scaffold a new `bunny.toml` config file. Prompts for name, runtime, and regions. If a `Dockerfile` is detected in the current directory, offers to use it for build-and-deploy and prompts for a container registry. Otherwise prompts for a container image.

```bash
bunny apps init
bunny apps init --name my-api --runtime shared --image nginx:latest
```

| Flag        | Description                           |
| ----------- | ------------------------------------- |
| `--name`    | App name (defaults to directory name) |
| `--runtime` | Runtime type: `shared` or `reserved`  |
| `--image`   | Primary container image               |

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

Deploy an app. If `bunny.toml` has no `id`, the app is created on Bunny first. If `dockerfile` is set in the container config, the image is built and pushed automatically (prompts for a registry if not configured). Use `--image` to skip the build and deploy a pre-built image.

```bash
# Build from Dockerfile + deploy
bunny apps deploy

# Deploy a pre-built image
bunny apps deploy --image ghcr.io/myorg/api:v1.2
```

| Flag      | Description                                          |
| --------- | ---------------------------------------------------- |
| `--image` | Container image to deploy (skips Dockerfile build)   |

#### `bunny apps pull` / `bunny apps push`

Sync configuration between the remote API and local `bunny.toml`.

```bash
# Pull remote state to local bunny.toml
bunny apps pull
bunny apps pull --force

# Push local bunny.toml to remote
bunny apps push
bunny apps push --dry-run
```

#### `bunny apps accessory`

Manage accessory containers (databases, caches, sidecars). Accessories are defined in the `[accessories]` section of `bunny.toml`.

```bash
# List accessories
bunny apps accessory list

# Start an accessory from bunny.toml
bunny apps accessory start postgres
bunny apps accessory start all

# Stop an accessory
bunny apps accessory stop redis --force

# Restart all containers
bunny apps accessory restart
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

| Flag          | Description                        |
| ------------- | ---------------------------------- |
| `--container` | Target container (default: primary)|

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

#### `bunny apps registry`

Manage container registries (account-level).

```bash
bunny apps registry list
bunny apps registry add --name "GitHub" --username myorg
bunny apps registry remove <registry-id>
```

### `bunny scripts`

Manage Edge Scripts.

#### `bunny scripts init`

Create a new Edge Script project from a template.

```bash
# Interactive wizard
bunny scripts init

# Non-interactive
bunny scripts init --name my-script --type standalone --template Empty --deploy
```

| Flag             | Description                               |
| ---------------- | ----------------------------------------- |
| `--name`         | Project directory name                    |
| `--type`         | Script type: `standalone` or `middleware` |
| `--template`     | Template name                             |
| `--deploy`       | Deploy after creation                     |
| `--skip-git`     | Skip git initialization                   |
| `--skip-install` | Skip dependency installation              |

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

```bash
# Run directly
bun run src/index.ts <command>

# Watch mode
bun --watch src/index.ts

# Type check
bun run typecheck

# Run tests
bun test

# Build standalone executable
bun run build

# Update OpenAPI specs and regenerate types
bun run api:update
```
