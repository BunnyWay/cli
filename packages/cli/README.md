# @bunny.net/cli

Command-line interface for [bunny.net](https://bunny.net) — manage databases, static sites, apps (Magic Containers), Edge Scripts, and more from your terminal.

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
# Browser-based login
bunny login

# Login to a specific profile
bunny login --profile staging

# Overwrite existing profile without prompting
bunny login --force

# Skip the browser entirely (remote machines, containers, CI)
bunny login --api-key "$BUNNYNET_API_KEY"
```

#### Remote and headless machines

The browser flow needs a browser you can actually see, which rules out SSH sessions, CI jobs, containers, and Unix hosts with no display server. `bunny login` checks for those before it opens anything.

With a terminal, it warns which case it hit, then offers to take an API key at a masked prompt (create one in the dashboard under Account Settings > API) or to print the login URL together with the `ssh -L` forward that makes the callback reachable. Without one, as with an agent or a CI job, it exits with a hint instead of waiting on a callback nothing can answer.

So for unattended runs, pass the key:

```bash
bunny login --api-key "$BUNNYNET_API_KEY"
```

Add `--output json` to get `{ "authenticated": true, "profile": "...", "name": "..." }` on stdout instead of the greeting.

The CLI checks the key against the API before writing the profile, so a bad one fails here rather than on the next command. You can also skip `bunny login` entirely and export `BUNNYNET_API_KEY`; it takes priority over any stored profile.

### `bunny logout`

Remove a stored authentication profile.

```bash
bunny logout
bunny logout --force
```

### `bunny whoami`

Show the currently authenticated account, including your name, email, and account ID.

```bash
bunny whoami
# Logged in as Jamie Barton (jamie@bunny.net) 🐇
# Account ID: 0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d
# Profile: default

bunny whoami --output json
bunny whoami --profile staging
```

### `bunny open`

Open the bunny.net dashboard in your default browser. Uses `BUNNYNET_DASHBOARD_URL` if set, otherwise `https://dash.bunny.net`.

```bash
bunny open

# Print the URL instead of opening it
bunny open --print

# Print as JSON
bunny open --print --output json
```

### `bunny docs`

Open the bunny.net documentation in your default browser.

```bash
bunny docs
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

| Flag      | Description               |
| --------- | ------------------------- |
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

| Flag         | Description                               |
| ------------ | ----------------------------------------- |
| `--primary`  | Comma-separated primary region IDs to add |
| `--replicas` | Comma-separated replica region IDs to add |

#### `bunny db regions remove`

Remove primary or replica regions from a database.

```bash
bunny db regions remove --primary FR
bunny db regions remove --replicas UK,NY
```

| Flag         | Description                                  |
| ------------ | -------------------------------------------- |
| `--primary`  | Comma-separated primary region IDs to remove |
| `--replicas` | Comma-separated replica region IDs to remove |

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

When no `--token` is supplied and `BUNNY_DATABASE_AUTH_TOKEN` is not set, the shell session is active for 30 minutes. Re-run the command to reconnect, or pass `--token` / set `BUNNY_DATABASE_AUTH_TOKEN` to use your own credentials.

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
bunny db shell --url libsql://01KCHBG8C5KSFGG0VRNFQ7EK7X-my-app.lite.bunnydb.net --token ey...
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

#### `bunny db studio`

Open a read-only table viewer in your browser. Spins up a local server, generates a short-lived auth token if needed, and opens the studio UI.

```bash
# Auto-detect database (link, .env, or interactive)
bunny db studio

# Specific database
bunny db studio <database-id>

# Custom port
bunny db studio --port 3000

# Don't auto-open the browser
bunny db studio --no-open

# Use explicit credentials (skips API lookup)
bunny db studio --url libsql://01KCHBG8C5KSFGG0VRNFQ7EK7X-my-app.lite.bunnydb.net --token ey...
```

| Flag        | Description                                     |
| ----------- | ----------------------------------------------- |
| `--port`    | Port for the local studio server (default 4488) |
| `--url`     | Database URL (skips API lookup)                 |
| `--token`   | Auth token (skips token generation)             |
| `--no-open` | Don't automatically open the browser            |

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

### `bunny registry`

> **Experimental** internal use only

Push and inspect images on the bunny.net OCI registry. The endpoint defaults to `registry.bunny.net`; set the `BUNNYNET_REGISTRY_URL` environment variable to override it.

```bash
bunny registry push myapp:latest                      # push, deriving repository/tag from the image
bunny registry push myapp:dev --repository myapp --tag v1
bunny registry list                                   # list repositories (alias: ls)
bunny registry tags myapp                             # list tags for a repository
```

`push` currently uses Docker to read the local image; `list` and `tags` talk to the registry directly. On the registry itself repositories are namespaced by your account id (`<account-id>/myapp`); the CLI adds and hides that prefix automatically, so you always work with the bare repository name.

### `bunny dns`

Manage DNS through two resource groups: **`bunny dns record`** (the entries within a zone) and **`bunny dns zone`** (the zone itself — settings, DNSSEC, logging, stats, nameservers). The `[domain]` argument accepts either the zone's domain name or its numeric zone ID, and is optional everywhere — omit it and you'll be prompted to pick a zone. `record update`/`record remove` likewise prompt you to pick a record when the ID is omitted. `record` aliases to `records`/`rec`; `zone` aliases to `zones` (and `domain`/`domains`).

```bash
# Records — list within a zone
bunny dns record list example.com
bunny dns rec ls example.com

# Add records (use '@' for the zone apex)
bunny dns record add example.com api A 198.51.100.1
bunny dns record add example.com '@' MX mail.example.com 10
bunny dns record add example.com '@' SRV 10 0 389 sip.example.com
bunny dns record add example.com '@' CAA '0 issue "letsencrypt.org"'

# Link a record to a pull zone or Edge Script
bunny dns record add example.com cdn PullZone --pull-zone 12345
bunny dns record add example.com fn Script --script 67890

# Interactive wizard — omit the record type (or all args) to be prompted
bunny dns record add
bunny dns record add example.com

# Update / remove a record by its ID
bunny dns record update example.com 123 --value 198.51.100.2 --ttl 3600
bunny dns record remove example.com 123

# Import / export a BIND zone file
bunny dns record import example.com ./zonefile.txt
bunny dns record export example.com                  # print to stdout
bunny dns record export example.com --file ./my.zone # write to a path
bunny dns record export example.com --save           # write to ./example.com.zone

# Zones — lifecycle
bunny dns zone list
bunny dns zone add example.com
bunny dns zone add                # prompts for the domain
bunny dns zone show example.com
bunny dns zone remove example.com

# Query statistics (defaults to the last 30 days; text mode draws a bar chart)
bunny dns zone stats example.com
bunny dns zone stats example.com --from 2026-05-01 --to 2026-05-31

# Nameservers to set at your registrar (custom if enabled, else bunny.net defaults)
bunny dns zone nameservers example.com
bunny dns zone ns example.com

# DNSSEC — enable prints the DS record to register at your domain registrar
bunny dns zone dnssec enable example.com
bunny dns zone dnssec disable example.com

# DNS query logging — enable to start collecting logs (optionally anonymize IPs)
bunny dns zone logging enable example.com
bunny dns zone logging enable example.com --anonymize-ip --anonymization drop
bunny dns zone logging disable example.com
```

Positional value ordering for `record add` follows the record type: `A`/`AAAA`/`CNAME`/`TXT`/`NS` take a single value, `MX` takes `<value> <priority>`, `SRV` takes `<priority> <weight> <port> <target>`, and `CAA` takes a single quoted `'<flags> <tag> "<value>"'` string. `PullZone` and `Script` records take no positional value — pass `--pull-zone <id>` or `--script <id>` instead. Omit the record type (or all arguments) to run an interactive wizard that prompts for the zone, type, and per-type values.

| Flag                                                                                                | Commands                                                                      | Description                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `--ttl`                                                                                             | `record add`, `record update`                                                 | Time to live in seconds                                              |
| `--comment`                                                                                         | `record add`, `record update`                                                 | Optional comment for the record                                      |
| `--pull-zone`, `--script`                                                                           | `record add`, `record update`                                                 | Link a `PullZone` / `Script` record by ID                            |
| `--name`, `--value`, `--type`, `--priority`, `--weight`, `--port`, `--flags`, `--tag`, `--disabled` | `record update`                                                               | Edit individual record fields (see `bunny dns record update --help`) |
| `--file`, `--save`                                                                                  | `record export`                                                               | Write to a path, or to `<domain>.zone` in the current directory      |
| `--from`, `--to`                                                                                    | `zone stats`                                                                  | Date range (defaults to the last 30 days)                            |
| `--anonymize-ip`, `--anonymization`                                                                 | `zone logging enable`                                                         | Anonymize client IPs in logs (`onedigit` \| `drop`)                  |
| `--force`                                                                                           | `record remove`, `zone remove`, `zone dnssec disable`, `zone logging disable` | Skip the confirmation prompt                                         |

### `bunny storage`

> **Experimental**: hidden from `--help` and the landing page while it stabilizes.

Manage Edge Storage through two resource groups: **`bunny storage zones`** (the zone itself: create, list, inspect, update, delete; alias `zone`, plus hidden `bucket`/`buckets`) and **`bunny storage files`** (the files within a zone; alias `file`). Zone management uses the account API key; file operations use the zone's own password and a region-specific host, both resolved automatically from the zone. `zones` commands take the zone as an optional `[zone]` positional; `files` commands take it as the `--zone`/`-z` flag (their positional is the file path). Either accepts the zone name or its numeric ID. When the zone is omitted it resolves from the directory's linked zone (`bunny storage link`, stored in `.bunny/storage.json`), then an interactive picker, which offers to link the directory to the picked zone (except on destructive commands). Non-interactive runs (`--output json`, no TTY, or `--force`) error instead of prompting; pass a zone or link the directory.

A storage zone only holds files; a **pull zone** is what serves them on the web. `zones add` offers to create one (origin set to the new storage zone) and then to add a custom domain, or pass `--pull-zone`/`--domain` to do it non-interactively. Custom domains live on the pull zone and are managed with `bunny storage zones domains`.

The tier (`--tier hdd|ssd`, Standard or Edge), the main region, and S3 compatibility (`--s3`) are all fixed at creation, so `zones add` prompts for each of them when the flag is omitted. Edge (SSD) zones are always primaried in `DE`, so `--tier ssd` rejects any other `--region` rather than letting the API rewrite it silently; replication regions are unaffected. `zones list` reports the tier and S3 support per zone, and `zones show` reports both plus the S3 endpoint when it's enabled.

After creating a zone, `add` offers to link the directory to it (`--link`/`--no-link`), to print connection details (`--connection http|ftp|s3`, optionally as a client config with `--format`), and to save those details to `.env` (`--save-env`). Credentials are shown in full there because they were explicitly asked for; `zones credentials` masks them by default.

```bash
# Zones (lifecycle)
bunny storage zones list
bunny storage zones add                                # interactive: prompts for name and region
bunny storage zones add my-zone --region DE
bunny storage zones add my-zone --region NY --replication LA,SG
bunny storage zones add my-zone --region DE --pull-zone   # also create a pull zone to serve it on the web
bunny storage zones add my-zone --region DE --domain cdn.example.com   # pull zone + custom domain
bunny storage zones add my-zone --tier ssd --s3        # Edge (SSD) tier (always DE) with S3-compatible access
bunny storage zones add my-zone --region DE --connection s3 --save-env   # print S3 credentials and write them to .env
bunny storage zones show my-zone
bunny storage zones update my-zone                     # interactive: edit settings, pre-filled with current values
bunny storage zones update my-zone --custom-404-path /404.html
bunny storage zones remove my-zone                     # confirms twice (yes/no, then type the zone name)

# Link the working directory to a zone so commands can omit it
bunny storage link my-zone
bunny storage unlink

# List the available storage regions
bunny storage regions

# Connection credentials: HTTP API, FTP, or S3 (one zone password, shaped per protocol)
bunny storage zones credentials my-zone                # pick a connection type, secret masked
bunny storage zones credentials my-zone --connection ftp --show-secret   # FTP host, username, password
bunny storage zones credentials my-zone --connection s3 --read-only      # use the read-only password as the secret
bunny storage zones credentials my-zone --format sdk   # @bunny.net/storage-sdk snippet (HTTP API)
bunny storage zones credentials my-zone --format rclone >> ~/.config/rclone/rclone.conf
eval "$(bunny storage zones credentials my-zone --format env)"   # AWS-compatible env vars
bunny storage zones credentials my-zone --connection http --save-env     # write the variables to .env

# Files: list, upload, download, delete (paths are relative to the zone root)
bunny storage files list --zone my-zone
bunny storage files list images/                       # linked zone
bunny storage files upload ./photo.png --to images/
bunny storage files upload ./photo.png --checksum --content-type image/png
bunny storage files download images/photo.png --out ./local.png
bunny storage files remove images/photo.png
bunny storage files remove images/ --force             # trailing slash removes a directory

# Custom domains on the zone's pull zone
bunny storage zones domains list my-zone
bunny storage zones domains add cdn.example.com my-zone
bunny storage zones domains ssl cdn.example.com my-zone
bunny storage zones domains remove cdn.example.com my-zone

# Open the storage documentation
bunny storage docs
```

A trailing slash on a `files` path denotes a directory: `files list images/` lists that directory, and `files remove images/` deletes it and its contents recursively. Edge Storage file operations are powered by the [`@bunny.net/storage-sdk`](https://github.com/BunnyWay/edge-script-sdk/tree/main/libs/bunny-storage).

bunny.net's S3-compatible API is in preview and is opt-in per zone at creation (`zones add --s3`); it cannot be enabled on an existing zone. When a zone has it, `bunny storage zones show` surfaces its S3 endpoint, and `bunny storage zones credentials --connection s3` emits the endpoint, region, access key (the zone name), and secret (the zone password) as a table, as JSON (`--output json`), or as ready-to-use config for `rclone`, the AWS CLI, `s3cmd`, or your shell (`--format`). The table and JSON output mask the secret by default; pass `--show-secret` to reveal it (`--format` always emits it in full, since it's meant to be consumed by tools, and under `--output json` the config rides along in a `config` field). The access key and secret are the zone's existing name and password, so there's nothing new to rotate beyond the zone's own credentials.

The same command also serves the two protocols every zone has: `--connection http` (the base URL and `AccessKey` header, plus a `--format sdk` snippet for [`@bunny.net/storage-sdk`](https://github.com/BunnyWay/edge-script-sdk/tree/main/libs/bunny-storage)) and `--connection ftp` (host, username, password). `--format` implies its protocol, so a conflicting `--connection` is an error. `--save-env` writes the protocol's variables (`BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, `BUNNY_STORAGE_REGION`, or the `AWS_*` quad for S3) into whichever `.env` already holds one of them.

| Flag                                                                                        | Commands                                 | Description                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--region`, `--replication`                                                                 | `zones add`                              | Primary region code, plus optional replication regions (any storage region except the primary; run `storage regions` to list them) |
| `--tier` (`hdd` \| `ssd`), `--s3`                                                           | `zones add`                              | Storage tier and S3-compatible access; both are create-time only, and `--tier ssd` forces `DE` as the main region                  |
| `--link`, `--connection` (`http` \| `ftp` \| `s3`), `--format`, `--save-env`                | `zones add`                              | Post-create follow-ups: link the directory, print connection details (or a client config), and save them to `.env`                 |
| `--pull-zone`, `--pull-zone-name`, `--domain`                                               | `zones add`                              | Also create a pull zone (what serves the stored files on the web) and optionally a custom domain; interactively, `add` offers both |
| `--custom-404-path`, `--rewrite-404-to-200`, `--replication`                                | `zones update`                           | Edit zone settings; replication is additive since replicas can't be removed (see `bunny storage zones update --help`)              |
| `--connection` (`http` \| `ftp` \| `s3`), `--save-env`                                      | `zones credentials`                      | Pick the protocol to print (prompts when omitted); save its variables to `.env`                                                    |
| `--format` (`sdk` \| `rclone` \| `aws` \| `s3cmd` \| `env`), `--read-only`, `--show-secret` | `zones credentials`                      | Emit a client config (`sdk` for the HTTP API, the rest for S3); use the read-only password; reveal the masked secret               |
| `--zone`, `-z`                                                                              | all `files` commands                     | Storage zone name or ID (defaults to the linked zone)                                                                              |
| `--to`                                                                                      | `files upload`                           | Remote path; a trailing slash uploads into that directory                                                                          |
| `--checksum`, `--content-type`                                                              | `files upload`                           | Send a SHA256 checksum for server-side verification; set the stored content type                                                   |
| `--out`                                                                                     | `files download`                         | Local destination path (defaults to the file name)                                                                                 |
| `--force`                                                                                   | `zones remove`, `files remove`, `unlink` | Skip the confirmation prompts                                                                                                      |

### `bunny scripts`

Manage Edge Scripts.

#### `bunny scripts init`

Create a new Edge Script project from a template.

```bash
# Interactive wizard
bunny scripts init

# Non-interactive, no GitHub Actions workflow
bunny scripts init --name my-script --type standalone --template Empty --no-github-actions --deploy

# Non-interactive, keep the GitHub Actions workflow
bunny scripts init --name my-script --type standalone --template Empty --github-actions --deploy

# Use a custom template repo (GitHub owner/repo shorthand)
bunny scripts init --repo owner/my-template

# Use a custom template repo (full git URL)
bunny scripts init --template-repo https://github.com/owner/my-template
```

| Flag                        | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `--name`                    | Project directory name                                                               |
| `--type`                    | Script type: `standalone` or `middleware`                                            |
| `--template`                | Template name                                                                        |
| `--template-repo`, `--repo` | Git repository URL or GitHub `owner/repo` shorthand to use as template               |
| `--github-actions`          | Keep the template's GitHub Actions workflow (use `--no-github-actions` to remove it) |
| `--deploy`                  | Create script on bunny.net after scaffolding                                         |
| `--skip-git`                | Skip git initialization                                                              |
| `--skip-install`            | Skip dependency installation                                                         |

When `--repo` / `--template-repo` is given without `--type`, the script type defaults to `standalone`.

After creating the script on bunny.net, the interactive wizard also asks for an optional custom domain — the same DNS + HTTPS flow as `bunny scripts create` and `bunny scripts domains add`, including the offer to wire up the DNS record for you (after confirmation) when the domain is on Bunny DNS.

With `--github-actions`, git is initialized automatically, the template's `.github/` workflow is kept, and after creating the script you'll be shown the `SCRIPT_ID` to add as a GitHub repo secret. With `--no-github-actions`, the `.github/` directory is removed and git init is prompted (or skipped via `--skip-git`).

The `.changeset/` directory is always removed from the template — bunny scripts don't use it.

#### `bunny scripts create`

Create a new Edge Script on bunny.net (without scaffolding a project). Use this when you have an existing project — for example, you ran `bunny scripts init` without `--deploy` — and need a remote script before running `bunny scripts deploy`.

```bash
# Create using current directory name + link .bunny/script.json
bunny scripts create

# Explicit name and type
bunny scripts create my-script --type middleware

# Skip pull zone creation and directory linking
bunny scripts create my-script --no-pull-zone --no-link

# Create and attach a custom domain
bunny scripts create my-script --domain shop.example.com
```

| Flag               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--type`           | Script type: `standalone` or `middleware` (defaults to manifest, prompts if interactive) |
| `--pull-zone`      | Create a linked pull zone (default: true). Use `--no-pull-zone` to skip.                 |
| `--pull-zone-name` | Name for the linked pull zone                                                            |
| `--link`           | Link this directory to the new script (default: true). Use `--no-link` to skip.          |
| `--domain`         | Add a custom domain to the new script's pull zone (prompted when interactive)            |

When run interactively, `create` also asks for an optional custom domain. If that domain is already in one of your Bunny DNS zones, it offers to add (or repoint) the DNS record for you — declining, or any record it would overwrite, always prompts first, and nothing is changed without confirmation. With the record in place, DNS is live on bunny's resolvers immediately, so it skips straight to issuing the free SSL certificate. Otherwise it prints the `CNAME` record to create and offers to wait while DNS propagates, issuing the certificate automatically once the domain points at bunny.net — the same flow as `bunny scripts domains add --wait`.

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

| Flag             | Description                    |
| ---------------- | ------------------------------ |
| `--skip-publish` | Upload code without publishing |

After publishing, the live URL and any custom domains are printed.

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

Show details for an Edge Script. Uses the linked script from `.bunny/script.json` if no ID is provided. Output includes the script's hostnames (system and custom) with their SSL status.

```bash
bunny scripts show <script-id>
bunny scripts show
```

#### `bunny scripts stats`

Show usage statistics for an Edge Script — request, CPU, and cost totals over the period, plus a per-bucket requests-served bar chart in text mode (buckets are labelled with friendly UTC dates, e.g. `May 19, 2026`, or date + time with `--hourly`). Defaults to the last 30 days.

When no ID is given, the command resolves the linked script from `.bunny/script.json`. If there is no link either, it prompts you to pick a script and offers to link the directory for next time. In `--output json` mode the picker is skipped and the command errors instead — pass an ID or run `bunny scripts link` in CI.

```bash
bunny scripts stats
bunny scripts stats 12345 --from 2026-05-01 --to 2026-05-31
bunny scripts stats 12345 --hourly
bunny scripts stats 12345 --output json

# Pick interactively without being asked to link (e.g. one-off checks)
bunny scripts stats --no-link
```

| Flag       | Description                                                                        |
| ---------- | ---------------------------------------------------------------------------------- |
| `--from`   | Start date (YYYY-MM-DD); defaults to 30 days ago                                   |
| `--to`     | End date (YYYY-MM-DD); defaults to today                                           |
| `--hourly` | Group statistics by hour instead of by day                                         |
| `--link`   | After an interactive pick, link the directory (use `--no-link` to skip the prompt) |

#### `bunny scripts delete`

Delete an Edge Script. Uses the linked script if no ID is provided. Requires double confirmation (or `--force` to skip).

```bash
bunny scripts delete <script-id>
bunny scripts delete
bunny scripts delete <script-id> --force
```

| Flag      | Description               |
| --------- | ------------------------- |
| `--force` | Skip confirmation prompts |

#### `bunny scripts deployments`

Manage Edge Script deployments.

##### `bunny scripts deployments list`

List deployments for an Edge Script. Uses the linked script if no ID is provided.

```bash
bunny scripts deployments list
bunny scripts deployments ls
bunny scripts deployments list <script-id>
bunny scripts deployments list --output json
```

##### `bunny scripts deployments publish`

Publish (roll back to) a past deployment by its release ID, as shown in `deployments list`. `bunny scripts deploy` already uploads and publishes in one step; use this to re-publish an earlier release without touching the current code. Uses the linked script if no ID is provided.

```bash
bunny scripts deployments publish <release-id>
bunny scripts deployments publish <release-id> <script-id>
bunny scripts deployments publish <release-id> --force
```

| Flag      | Description                  |
| --------- | ---------------------------- |
| `--force` | Skip the confirmation prompt |

#### `bunny scripts env`

Manage environment variables and secrets for an Edge Script. All subcommands default to the linked script; pass `--id <script-id>` to target another.

##### `bunny scripts env list`

List environment variables and secrets.

```bash
bunny scripts env list
bunny scripts env ls
bunny scripts env list --output json
```

##### `bunny scripts env set`

Set an environment variable or secret. Runs interactively when arguments are omitted. The variable name is uppercased.

```bash
bunny scripts env set MY_VAR value
bunny scripts env set            # interactive
bunny scripts env set API_KEY secret-value --secret
```

| Flag       | Description                             |
| ---------- | --------------------------------------- |
| `--secret` | Store as an encrypted secret            |
| `--id`     | Edge Script ID (uses linked if omitted) |

##### `bunny scripts env remove`

Remove an environment variable or secret. Shows an interactive picker when no name is given; prompts for confirmation unless `--force`.

```bash
bunny scripts env remove MY_VAR
bunny scripts env rm MY_VAR -f
```

##### `bunny scripts env pull`

Pull environment variables to a local `.env` file.

```bash
bunny scripts env pull
bunny scripts env pull <script-id>
bunny scripts env pull --force
```

| Flag      | Description                                    |
| --------- | ---------------------------------------------- |
| `--force` | Overwrite an existing `.env` without prompting |

#### `bunny scripts domains`

Manage custom domains for an Edge Script. A script's domains live on its linked pull zone, so these commands operate on that pull zone. All subcommands default to the linked script; pass a trailing `[id]` positional (or the equivalent `--id <script-id>` flag) to target another, and `--pull-zone <id>` when a script has more than one linked pull zone. (`bunny scripts hostnames` is kept as a hidden alias.)

##### `bunny scripts domains add`

Add a custom domain. SSL is **not** requested by default — a free certificate can only be issued once your DNS points at bunny.net, so the command prints the `CNAME` record to create. When run interactively it then offers to wait while DNS propagates (checking every few seconds, up to 10 minutes) and issues the certificate automatically once the domain is live; pass `--wait` to do that without the prompt, or `--ssl` to issue a certificate immediately. HTTP is redirected to HTTPS by default (opt out with `--no-force-ssl`).

```bash
# Add a domain, get DNS instructions, and optionally wait for DNS + HTTPS
bunny scripts domains add shop.example.com

# Add, wait for DNS to propagate, then enable HTTPS — no prompts
bunny scripts domains add shop.example.com --wait

# Add and request SSL now (DNS must already be pointed at bunny.net) — HTTPS forced
bunny scripts domains add shop.example.com --ssl

# Add and request SSL without forcing HTTPS
bunny scripts domains add shop.example.com --ssl --no-force-ssl

# Target a script other than the linked one
bunny scripts domains add shop.example.com 12345
```

| Flag             | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `--ssl`          | Issue a free SSL certificate now and force HTTPS (requires DNS pointed) |
| `--wait`         | Wait for DNS to point at bunny.net (up to 10 minutes), then issue SSL   |
| `--no-force-ssl` | When issuing SSL, keep serving HTTP instead of redirecting to HTTPS     |
| `[id]` / `--id`  | Edge Script ID (uses linked script if omitted)                          |
| `--pull-zone`    | Pull zone ID (required if the script has multiple linked zones)         |

##### `bunny scripts domains ssl`

Request a free SSL certificate for a custom domain. Run this after the domain's DNS points at bunny.net (see the `CNAME` printed by `domains add`). HTTP is redirected to HTTPS by default; pass `--no-force-ssl` to keep plain HTTP.

```bash
bunny scripts domains ssl shop.example.com
bunny scripts domains ssl shop.example.com --no-force-ssl
```

##### `bunny scripts domains list`

List the domains on a script's pull zone, with SSL and Force SSL status.

```bash
bunny scripts domains list
bunny scripts domains ls
bunny scripts domains list --output json
```

##### `bunny scripts domains remove`

Remove a custom domain. System hostnames controlled by bunny.net cannot be removed.

```bash
bunny scripts domains remove shop.example.com
bunny scripts domains remove shop.example.com --force
```

#### `bunny scripts docs`

Open the Edge Scripts documentation in your browser.

```bash
bunny scripts docs
```

### `bunny sites`

> **Experimental**: hidden from `--help` and the landing page while it stabilizes.

Host static sites on bunny.net. Each site is two resources provisioned and wired together for you: a **storage zone** holding the files and a **pull zone** serving them over the CDN, with edge rules that route requests to the deploy that should answer them. Zones are named `sites-<name>-<suffix>` (the prefix groups them in the dashboard; the suffix is because zone names are global across bunny.net) while commands take the clean site name.

Deploys are immutable: every `sites deploy` uploads to its own `deploys/<id>/` directory and then goes live. Publishing retargets the pull zone's rewrite rule and purges the cache, so going live and rolling back to any earlier deploy are instant and move no files. HTML is served with `max-age=0` so browsers pick up new deploys immediately, while static assets get a one-day browser cache. Deploy IDs are the git short SHA when the working tree is clean and a content hash otherwise, which makes redeploying identical content a no-op.

Commands take the site as an optional positional (`[site]`), except `deploy`, `ci init`, and `deployments publish`, which use `--site`. Either accepts the site name or its storage zone ID. When omitted, the site resolves from the directory's linked site (`.bunny/site.json`, written by `sites link` or by `create`/`deploy`), then `sites.name` in `bunny.jsonc`, then an interactive picker that offers to link. Non-interactive runs (`--output json`, no TTY, or `--force` on a destructive command) error instead of prompting.

```bash
# Provision a site
bunny sites create                                    # interactive: prompts for a name (directory-name suggestion)
bunny sites create my-site                            # served at sites-my-site-<suffix>.b-cdn.net
bunny sites create my-site --region NY                # store the files in New York (default: DE)
bunny sites create my-site --domain example.com       # also attach a custom production domain

# Deploy
bunny sites deploy                                    # detects the framework, offers to build, then deploys
bunny sites deploy ./dist                             # deploy a directory and publish it as the live site
bunny sites deploy --build                            # run `sites.build` from bunny.jsonc (else the detected build), then deploy
bunny sites deploy --build "npm run build" --env API_URL=https://api.example.com
bunny sites deploy ./dist --site my-site --force      # target a site explicitly; redeploy unchanged content
bunny sites deploy ./catalog --deploy-id 20260827-1433-r42   # your own release ID instead of the git sha / content hash

# Deploys: list, publish (roll back), prune
bunny sites deployments list                          # ● Live / ○ Previous markers, created, source, files, size
bunny sites deployments publish a1b2c3d4              # promote a past deploy (alias: promote)
bunny sites deployments publish --previous            # instant rollback
bunny sites deployments prune --keep 10               # delete old deploys (default keeps 5; never live/previous)

# Custom production domains
bunny sites domains list
bunny sites domains add shop.example.com              # prints the DNS record to create
bunny sites domains add shop.example.com --wait       # add, wait for DNS, then issue SSL and force HTTPS
bunny sites domains add shop.example.com --ssl --no-force-ssl   # issue SSL now, keep HTTP available
bunny sites domains ssl shop.example.com
bunny sites domains remove shop.example.com --force

# Inspect, open, and force HTTPS on the b-cdn.net system host
bunny sites list                                      # alias: ls
bunny sites show                                      # resources, domains, SSL state, current deploy
bunny sites open --print
bunny sites ssl --no-force-ssl

# CI, linking, maintenance
bunny sites ci init                                   # GitHub Actions: push to main goes live
bunny sites ci init --framework astro
bunny sites link my-site
bunny sites unlink
bunny sites delete my-site --keep-storage             # typed-name confirmation; keeps the deploy files
```

Preconfigure the `sites` block in `bunny.jsonc` (`name`, `build`, `dir`) and a deploy needs no arguments: `bunny sites deploy --build`. `sites ci init` reads the same block, so the generated workflow builds and deploys exactly what the local command does; without it, the framework is detected from `package.json` deps, `Gemfile`, or a `hugo`/`python`/`zola` config file, with the lockfile picking the package manager. `sites create` offers to scaffold the workflow on GitHub repos.

Every deploy publishes: the files land in an immutable `deploys/<id>/` directory and the rewrite rule is pointed at it, so `deployments publish` rolls back to any earlier deploy by moving that pointer, with no files moving and nothing re-uploaded. The ID is the git short-sha when the tree is clean, a content hash otherwise, or whatever `--deploy-id` supplies (letters, digits, `-`, `_`, `.`; 4-64 chars; case-sensitive): a custom ID never aliases onto another deploy's content, and reusing one for different content asks before replacing (`--force` skips the prompt); a replacement clears the old files first, so nothing stale survives. The live deploy and the rollback target are never replaced in place; deploy those under a new ID. Content is root-served, so client-side routing and absolute asset paths work as-is. Direct `/deploys/<id>/` URLs are blocked at the edge. Site state lives at `_bunny/site.json` inside the storage zone (also blocked at the edge); `.bunny/site.json` is only a local pointer, so a fresh clone can `sites link` and pick up where the last machine left off.

| Flag                                   | Commands                                                   | Description                                                                                        |
| -------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--region`, `--domain`                 | `create`                                                   | Main storage region code (default `DE`); custom production domain to attach                        |
| `--site`                               | `deploy`, `ci init`, `deployments publish`                 | Site name or storage zone ID (defaults to the linked site)                                         |
| `--build [cmd]`, `--env`, `--env-file` | `deploy`                                                   | Build before deploying (bare flag uses the configured or detected build); build-time env overrides |
| `--force`                              | `deploy`                                                   | Deploy even when the content is unchanged, and replace an existing `--deploy-id` without asking    |
| `--deploy-id`                          | `deploy`                                                   | Identify the deploy yourself (release tag, catalog ID); case-sensitive, used exactly as given      |
| `--previous`                           | `deployments publish`                                      | Publish the previous deploy (instant rollback)                                                     |
| `--keep`                               | `deployments prune`                                        | Number of recent deploys to keep (default 5; live and previous are always kept)                    |
| `--ssl`, `--wait`, `--force-ssl`       | `domains add`                                              | Issue SSL now; wait up to 10 minutes for DNS then issue it; `--no-force-ssl` keeps HTTP working    |
| `--force-ssl`                          | `ssl`                                                      | Force HTTP→HTTPS on the system host; `--no-force-ssl` allows plain HTTP                            |
| `--framework`                          | `ci init`                                                  | Framework preset for the workflow's build steps (default: detected)                                |
| `--print`                              | `open`                                                     | Print the URL instead of opening a browser                                                         |
| `--link`                               | `create`, `deploy`, `show`, `ci init`, `deployments`       | Link the directory to the site; `--no-link` never links                                            |
| `--keep-storage`                       | `delete`                                                   | Delete the pull zone but keep the storage zone and its deploy files                                |
| `--force`, `-f`                        | `deployments publish`, `prune`, `domains remove`, `delete` | Skip the confirmation prompts                                                                      |

### `bunny sandbox`

Manage on-demand cloud sandbox environments backed by Bunny Magic Containers. Each sandbox is a fully isolated Ubuntu container with Node.js, Bun, Python (plus `uv`), the bunny CLI, and Claude Code pre-installed, alongside the tooling agents reach for: `git`, `gh`, `ripgrep`, `fd`, `jq`, `tmux`, `sqlite3`, `tree`, and `fzf`. A 10 GB persistent volume is mounted at `/workplace`, your default working directory.

`/workplace/bin` is included in the PATH, so anything you put there runs by name after a redeploy without an absolute path.

Claude Code is pre-installed but needs your own Anthropic credentials before it can do anything: pass an API key at create time (prefer `--env-file .env` so the key stays out of your shell history), or run `claude` inside the sandbox and complete the login prompt it prints. Both survive restarts and redeploys: baked env vars live on the container, and config and credentials are pinned to the persistent volume — `/workplace/.claude` for Claude Code, and `/workplace/.config` for the bunny CLI and `gh`.

Sandbox credentials (app ID, SSH endpoint, agent token) are stored in the CLI's local config file (`~/.config/bunnynet.json` by default) so you can reconnect without re-creating.

#### `bunny sandbox create`

Create and start a new sandbox. Waits for the container's SSH port to become reachable before returning.

```bash
# Create a sandbox with the default name "sandbox"
bunny sandbox create

# Create a named sandbox
bunny sandbox create my-sandbox

# Create in a specific region
bunny sandbox create my-sandbox --region NY

# Bake in environment variables (persisted for the sandbox's lifetime)
bunny sandbox create my-sandbox -e NODE_ENV=production -e PORT=8080
bunny sandbox create my-sandbox --env-file .env

# Give Claude Code your Anthropic API key at create time (.env holds ANTHROPIC_API_KEY)
bunny sandbox create my-sandbox --env-file .env
```

| Flag         | Alias | Description                                        | Default |
| ------------ | ----- | -------------------------------------------------- | ------- |
| `--region`   |       | Region ID to deploy in (e.g. `AMS`, `NY`, `LA`, …) | `AMS`   |
| `--env`      | `-e`  | Environment variable as `KEY=VALUE` (repeatable)   |         |
| `--env-file` |       | Load environment variables from a dotenv file      |         |

Variables set at creation are baked into the container and persist across restarts. Values from `--env` override those loaded from `--env-file`. To change them later, use [`bunny sandbox env`](#bunny-sandbox-env).

Once ready, the output shows the app ID and SSH address. Public URLs come later via [`bunny sandbox url add`](#bunny-sandbox-url-add).

#### `bunny sandbox list`

List all sandboxes saved in your local config.

```bash
bunny sandbox list
bunny sandbox ls          # alias
```

Columns: Name, App ID, SSH.

#### `bunny sandbox delete`

Delete a sandbox and permanently destroy the underlying Magic Containers app.

```bash
bunny sandbox delete my-sandbox

# Skip the confirmation prompt
bunny sandbox delete my-sandbox --force
bunny sandbox rm my-sandbox -f   # alias
```

| Flag      | Alias | Description              | Default |
| --------- | ----- | ------------------------ | ------- |
| `--force` | `-f`  | Skip confirmation prompt | `false` |

#### `bunny sandbox exec`

Run a shell command inside a sandbox over SSH. Defaults to `/workplace` as the working directory.

```bash
# Run a command
bunny sandbox exec my-sandbox ls -la

# Run in a different directory
bunny sandbox exec my-sandbox --cwd /tmp env

# Pipe-friendly: exit code is propagated
bunny sandbox exec my-sandbox -- cat /etc/os-release

# Inject temporary environment variables for this command only
bunny sandbox exec my-sandbox --env DEBUG=1 -- node app.js
bunny sandbox exec my-sandbox --env-file .env -- printenv

# Give up after 30 seconds (exit code 124)
bunny sandbox exec my-sandbox --timeout 30 -- bun run build
```

| Flag         | Alias | Description                                                     | Default      |
| ------------ | ----- | --------------------------------------------------------------- | ------------ |
| `--cwd`      |       | Working directory inside the sandbox                            | `/workplace` |
| `--env`      |       | Environment variable as `KEY=VALUE` (repeatable)                |              |
| `--env-file` |       | Load environment variables from a dotenv file                   |              |
| `--timeout`  |       | Close the SSH connection and exit `124` after this many seconds |              |

Variables passed here apply only to that single command and are **not** persisted. For persistent variables, use [`bunny sandbox env`](#bunny-sandbox-env).

#### `bunny sandbox files`

Manage files inside a sandbox over SFTP. A bare sandbox name targets `/workplace`; use `<sandbox>:<path>` for a specific directory (relative paths resolve against `/workplace`).

```bash
# List /workplace
bunny sandbox files list my-sandbox
bunny sandbox files ls my-sandbox    # alias

# List a specific directory
bunny sandbox files list my-sandbox:/workplace/src
bunny sandbox files list my-sandbox:src

# Machine-readable listing (name, type, size, mode)
bunny sandbox files list my-sandbox --output json
```

Columns: Name, Type (`file`/`directory`/`symlink`/`other`), Size, Mode (octal permissions).

Copy a single file between your machine and a sandbox with `cp`. Exactly one of the two paths must reference a sandbox as `<sandbox>:<path>`; the other is a local path.

```bash
# Upload a file into the sandbox
bunny sandbox files cp ./app.js my-sandbox:/workplace/app.js

# Upload relative to /workplace
bunny sandbox files cp ./app.js my-sandbox:app.js

# An existing remote directory (or a trailing slash) keeps the source filename
bunny sandbox files cp ./app.js my-sandbox:/workplace/src

# Download a file from the sandbox
bunny sandbox files cp my-sandbox:/workplace/out.log ./out.log

# Download into an existing directory (keeps the source filename)
bunny sandbox files cp my-sandbox:/workplace/out.log ./logs/
```

Uploads preserve the local file's Unix mode, so executables stay executable. Only single files are supported: directory and sandbox-to-sandbox copies are not.

`cp` used to live at `bunny sandbox cp`. That path now errors with the equivalent `bunny sandbox files cp` command to run instead.

#### `bunny sandbox ssh`

Open a full interactive SSH session. Drops you into a bash shell at `/workplace`. Type `exit` or press Ctrl-D to close.

```bash
bunny sandbox ssh my-sandbox

# Set temporary environment variables for the session
bunny sandbox ssh my-sandbox -e DEBUG=1 --env-file .env
```

| Flag         | Alias | Description                                      | Default |
| ------------ | ----- | ------------------------------------------------ | ------- |
| `--env`      | `-e`  | Environment variable as `KEY=VALUE` (repeatable) |         |
| `--env-file` |       | Load environment variables from a dotenv file    |         |

Variables apply only to the session and are not persisted.

#### `bunny sandbox url`

Manage public CDN endpoints for ports running inside a sandbox. Useful for exposing a dev server or API to the internet.

##### `bunny sandbox url add`

Expose a container port as a public HTTPS endpoint. Waits until the URL is provisioned and prints it.

```bash
# Expose port 3000 (endpoint named "port-3000")
bunny sandbox url add my-sandbox 3000

# Custom endpoint name
bunny sandbox url add my-sandbox 8080 --label my-api
```

| Flag      | Description                   | Default       |
| --------- | ----------------------------- | ------------- |
| `--label` | Display name for the endpoint | `port-<port>` |

##### `bunny sandbox url list`

List all user-created endpoints for a sandbox (built-in `api` and `ssh` endpoints are hidden).

```bash
bunny sandbox url list my-sandbox
bunny sandbox url ls my-sandbox    # alias
```

Columns: ID, Name, Type, Port, URL.

##### `bunny sandbox url delete`

Delete a public endpoint by name.

```bash
bunny sandbox url delete my-sandbox port-3000

# Skip confirmation
bunny sandbox url delete my-sandbox my-api --force
bunny sandbox url rm my-sandbox my-api -f   # alias
```

| Flag      | Alias | Description              | Default |
| --------- | ----- | ------------------------ | ------- |
| `--force` | `-f`  | Skip confirmation prompt | `false` |

#### `bunny sandbox env`

Manage a sandbox's **persistent** environment variables, the ones baked into the container. Unlike the temporary `--env` passed to `exec`/`ssh`, these survive across sessions. Changing them redeploys the sandbox with the new environment (running processes restart).

##### `bunny sandbox env set`

Set one or more persistent variables, merging with the existing set.

```bash
# Set a single variable
bunny sandbox env set my-sandbox NODE_ENV=production

# Set several at once
bunny sandbox env set my-sandbox API_URL=https://api.example.com LOG_LEVEL=debug

# Load from a dotenv file
bunny sandbox env set my-sandbox --env-file .env
```

| Flag         | Description                                   | Default |
| ------------ | --------------------------------------------- | ------- |
| `--env-file` | Load environment variables from a dotenv file |         |

##### `bunny sandbox env list`

List the sandbox's persistent variables. The internal `AGENT_TOKEN` is hidden.

```bash
bunny sandbox env list my-sandbox
bunny sandbox env ls my-sandbox    # alias
```

Columns: Name, Value.

##### `bunny sandbox env delete`

Remove one or more persistent variables. Names that are not set are reported and skipped; if none match, the command errors and nothing is redeployed.

```bash
bunny sandbox env delete my-sandbox NODE_ENV
bunny sandbox env rm my-sandbox API_URL LOG_LEVEL    # alias
bunny sandbox env unset my-sandbox API_URL           # alias
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

| Flag     | Alias | Description       |
| -------- | ----- | ----------------- |
| `--body` | `-b`  | JSON request body |

The method is case-insensitive (`get` and `GET` both work). Paths are relative to `https://api.bunny.net` — use `/database/...` for the Database API and `/mc/...` for Magic Containers.

### `bunny completion`

Generate a shell completion script. Add the output to your shell profile to enable tab completion.

```bash
bunny completion >> ~/.zshrc
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
