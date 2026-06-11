# Edge Script Commands

All Edge Script commands live under `bunny scripts`. Most accept an optional `ID` positional argument. When omitted, the ID is resolved in this order:

1. Explicit `ID` argument
2. `.bunny/script.json` manifest (written by `bunny scripts link`, `bunny scripts create`, or `bunny scripts init`)
3. An error asking you to link or pass an ID

`bunny scripts stats` adds an interactive picker as a final step and offers to link the directory for next time.

The manifest stores `{ id, name, scriptType }` and is gitignored — it's per-developer state.

## `bunny scripts init` — Create a new Edge Script project

```bash
bunny scripts init                                                           # interactive wizard
bunny scripts init --name my-script --type standalone --template Empty       # non-interactive
bunny scripts init --name my-script --type standalone --template Empty --deploy
bunny scripts init --name my-script --skip-install                           # skip dependency install
bunny scripts init --repo user/my-template                                   # custom GitHub template
bunny scripts init --name my-script --template-repo https://github.com/user/my-template
```

### Flags

| Flag                | Description                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| `--name`            | Project directory name (prompted if omitted)                                         |
| `--type`            | Script type: `standalone` or `middleware`                                            |
| `--template`        | Template name (e.g. `Empty`, `Return JSON`, `Simple Middleware`)                     |
| `--template-repo`   | Git repository URL or GitHub `owner/repo` shorthand (alias `--repo`)                 |
| `--deploy`          | Create the script on bunny.net after scaffolding                                     |
| `--github-actions`  | Keep the template's GitHub Actions workflow for CI deploys (use `--no-github-actions`) |
| `--skip-git`        | Skip git initialization                                                              |
| `--skip-install`    | Skip dependency installation                                                         |

Clones a starter template, removes its git history, installs dependencies with the detected package manager, writes `.bunny/script.json`, and optionally creates the remote script. When GitHub Actions stays enabled, the command prints the `SCRIPT_ID` secret to add to your repository.

`--template` and `--template-repo` cannot be used together. Dependency installation for custom template repos always asks for confirmation, since a template's lifecycle scripts run during install.

---

## `bunny scripts create` — Create a new Edge Script on bunny.net

```bash
bunny scripts create                                              # use current directory name
bunny scripts create my-script --type middleware                  # explicit name and type
bunny scripts create my-script --no-pull-zone --no-link           # skip pull zone and linking
bunny scripts create --output json                                # JSON output
```

### Flags

| Flag                | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `--type`            | Script type: `standalone` or `middleware`                                    |
| `--pull-zone`       | Create a linked pull zone (default: true). Use `--no-pull-zone` to skip.     |
| `--pull-zone-name`  | Name for the linked pull zone                                                |
| `--link`            | Link this directory to the new script (default: true). Use `--no-link` to skip. |

Creates the remote script and, by default, a linked pull zone and a `.bunny/script.json` link. Use this when you already have a project and need a remote script before running `bunny scripts deploy`. The script name defaults to the current directory name. The script type comes from `--type`, then the manifest, then an interactive prompt.

---

## `bunny scripts list` — List all Edge Scripts

```bash
bunny scripts list                   # table format
bunny scripts ls                     # alias
bunny scripts list --output json     # JSON format
```

Fetches standalone and middleware scripts (DNS scripts are excluded). Displays: ID, Name, Type, and linked Pull Zone hostnames.

---

## `bunny scripts show` — Show details of an Edge Script

```bash
bunny scripts show                       # linked script
bunny scripts show 12345                 # explicit ID
bunny scripts show --output json
```

Displays script metadata (type, hostnames, current release, last modified, monthly requests, CPU time, and cost), linked pull zones, custom hostnames with SSL state, and environment variables.

---

## `bunny scripts link` — Link the current directory to an Edge Script

```bash
bunny scripts link                       # interactive selection
bunny scripts link --id 12345            # direct link by ID
bunny scripts link --id 12345 --output json
```

Writes the script ID and metadata to `.bunny/script.json` so later commands resolve the target automatically. With `--id` the script is fetched and linked immediately. Without it, an interactive prompt lists every script in the account.

---

## `bunny scripts deploy` — Deploy code to an Edge Script

```bash
bunny scripts deploy dist/index.js               # deploy and publish
bunny scripts deploy dist/index.js --skip-publish # upload without publishing
bunny scripts deploy dist/index.js 12345          # deploy to a specific script
```

### Flags

| Flag             | Description                  |
| ---------------- | ---------------------------- |
| `--skip-publish` | Upload code without publishing |

Reads the built file, uploads it as the script code, and publishes it as a live release by default. After publishing, the live hostnames are printed.

---

## Deployments

### `bunny scripts deployments list` — List deployments

```bash
bunny scripts deployments list                   # linked script
bunny scripts deployments ls                      # alias
bunny scripts deployments list 12345              # by script ID
bunny scripts deployments list --output json
```

Shows each release's ID, Status (Live or Archived), Author, release date, and publish date. Deleted releases are excluded. When a release is live and the script has a linked pull zone, the live hostname is printed at the end.

### `bunny scripts deployments publish` — Publish (roll back to) a past deployment

```bash
bunny scripts deployments publish 42             # roll back linked script to release 42
bunny scripts deployments publish 42 12345        # roll back a specific script
bunny scripts deployments publish 42 --force      # skip confirmation
```

| Flag      | Short | Default | Description              |
| --------- | ----- | ------- | ------------------------ |
| `--force` | `-f`  | `false` | Skip the confirmation prompt |

Re-publishes an earlier release (by the ID shown in `deployments list`) as the live deployment. The current code is left untouched. Run this to roll back. After publishing, the live hostnames are printed.

---

## Environment Variables

Each script holds plain variables and encrypted secrets. Variable names are uppercased automatically.

### `bunny scripts env list` — List variables and secrets

```bash
bunny scripts env list                   # linked script
bunny scripts env ls                      # alias
bunny scripts env list 12345              # by script ID
bunny scripts env list --output json
```

Displays ID, Name, Value, and whether each entry is a Secret. Secret values are masked.

### `bunny scripts env set` — Set a variable or secret

```bash
bunny scripts env set MY_VAR "hello world"       # plain variable
bunny scripts env set API_KEY "sk-..." --secret   # encrypted secret
bunny scripts env set                             # interactive
bunny scripts env set MY_VAR "value" --id 12345
```

| Flag       | Description                                     |
| ---------- | ----------------------------------------------- |
| `--secret` | Store the value as an encrypted secret          |
| `--id`     | Edge Script ID (uses linked script if omitted)  |

Prompts for any missing name, value, or secret flag. Secret values are masked during input. The command errors when a name already exists held by the opposite type — remove the existing entry first.

### `bunny scripts env remove` — Remove a variable or secret

```bash
bunny scripts env remove MY_VAR           # by name
bunny scripts env remove                   # interactive select
bunny scripts env remove MY_VAR --force    # skip confirmation
bunny scripts env rm MY_VAR -f             # alias
```

| Flag      | Short | Default | Description              |
| --------- | ----- | ------- | ------------------------ |
| `--force` | `-f`  | `false` | Skip confirmation prompt |
| `--id`    |       |         | Edge Script ID           |

With no name, shows an interactive select list. Prompts for confirmation before deleting.

### `bunny scripts env pull` — Pull variables to a local .env file

```bash
bunny scripts env pull                   # linked script
bunny scripts env pull 12345              # by script ID
bunny scripts env pull --force            # overwrite without prompting
```

| Flag      | Short | Default | Description                            |
| --------- | ----- | ------- | -------------------------------------- |
| `--force` | `-f`  | `false` | Overwrite existing `.env` without prompting |

Writes each variable as a `NAME=VALUE` line to `.bunny/.env` (mode `0600`). Secrets are not included — their values cannot be read back from the API.

---

## Custom Domains

Custom domains live on the script's linked pull zone. When a script has several linked pull zones, pass `--pull-zone <id>` to choose one. `bunny scripts hostnames` is a hidden alias for `bunny scripts domains`.

### `bunny scripts domains add` — Add a custom domain

```bash
bunny scripts domains add shop.example.com                 # add (no SSL)
bunny scripts domains add shop.example.com --ssl           # add and request SSL now
bunny scripts domains add shop.example.com --ssl --no-force-ssl
```

| Flag          | Default | Description                                                                       |
| ------------- | ------- | --------------------------------------------------------------------------------- |
| `--ssl`       |         | Issue a free SSL certificate now and force HTTPS (DNS must already point at bunny.net) |
| `--force-ssl` | `true`  | Force HTTP→HTTPS when issuing SSL. Use `--no-force-ssl` to keep HTTP.             |
| `--id`        |         | Edge Script ID                                                                    |
| `--pull-zone` |         | Pull zone ID (required when the script has multiple linked zones)                 |

Adds the domain and prints the CNAME target to point your DNS at bunny.net. With `--ssl`, the certificate is requested immediately.

### `bunny scripts domains ssl` — Request a free SSL certificate

```bash
bunny scripts domains ssl shop.example.com               # issue and force HTTPS
bunny scripts domains ssl shop.example.com --no-force-ssl # issue without forcing HTTPS
```

| Flag          | Default | Description                                                          |
| ------------- | ------- | -------------------------------------------------------------------- |
| `--force-ssl` | `true`  | Force HTTP→HTTPS after issuing. Use `--no-force-ssl` to keep HTTP.   |

Issues a free certificate for an existing custom domain. The domain's DNS must already point at bunny.net.

### `bunny scripts domains list` — List domains

```bash
bunny scripts domains list                   # table format
bunny scripts domains ls                      # alias
bunny scripts domains list --output json
```

Displays Domain, Type (System or Custom), SSL, and Force SSL for the linked pull zone.

### `bunny scripts domains remove` — Remove a custom domain

```bash
bunny scripts domains remove shop.example.com           # with confirmation
bunny scripts domains rm shop.example.com                # alias
bunny scripts domains remove shop.example.com --force    # skip confirmation
```

| Flag      | Short | Default | Description              |
| --------- | ----- | ------- | ------------------------ |
| `--force` | `-f`  | `false` | Skip confirmation prompt |

---

## `bunny scripts stats` — Show usage statistics

```bash
bunny scripts stats                                          # linked script, last 30 days
bunny scripts stats 12345 --from 2026-05-01 --to 2026-05-31  # date range
bunny scripts stats 12345 --hourly --output json             # hourly grouping
```

### Flags

| Flag       | Description                                                            |
| ---------- | --------------------------------------------------------------------- |
| `--from`   | Start date (`YYYY-MM-DD`); defaults to 30 days ago                    |
| `--to`     | End date (`YYYY-MM-DD`); defaults to today                            |
| `--hourly` | Group statistics by hour                                              |
| `--link`   | Link the directory to the picked script (use `--no-link` to skip the prompt) |

Displays total requests, CPU time, average CPU per execution, and cost over the period, plus a requests-served bar chart. With no ID, it falls back to the linked script, then to an interactive picker that offers to link the directory.

---

## `bunny scripts delete` — Delete an Edge Script

```bash
bunny scripts delete 12345               # interactive double confirmation
bunny scripts delete                      # linked script
bunny scripts delete 12345 --force        # skip confirmation
bunny scripts delete 12345 --force --output json
```

| Flag      | Short | Default | Description              |
| --------- | ----- | ------- | ------------------------ |
| `--force` | `-f`  | `false` | Skip confirmation prompts |

**This is destructive** — the script and all its deployments, environment variables, and secrets are permanently removed. Requires two confirmations without `--force`:

1. A yes/no confirmation prompt
2. Typing the script name to verify

---

## `bunny scripts docs` — Open the documentation

```bash
bunny scripts docs
```

Opens the Edge Scripts documentation in the default browser.
