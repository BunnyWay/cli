# Edge Scripts Commands

All Edge Script commands live under `bunny scripts`. Edge Scripts are serverless functions that run on bunny.net's edge network, powered by the Compute API. There are two script types:

- **Standalone** (type 1) — handles requests independently (its own endpoint).
- **Middleware** (type 2) — processes requests before/after an origin.

(DNS scripts, type 0, exist in the API but are not managed by these commands — `list` and `link` only surface standalone and middleware scripts.)

## Script ID resolution

Most commands accept an optional script ID (positional `[id]`, or `--id` for `link`/`env`). When omitted, the ID resolves in this order:

1. Explicit `id` argument (or `--id` flag)
2. `.bunny/script.json` manifest (written by `bunny scripts link`, `bunny scripts create`, or `bunny scripts init`)

If neither provides an ID, the command errors with a hint to run `bunny scripts link`.

The manifest stores `{ id, name, scriptType }` and is resolved by walking **up** the directory tree from the current working directory to find the nearest `.bunny/script.json`. It is per-developer state and should stay gitignored — `init` adds `.bunny/` to `.gitignore` automatically.

## Typical workflow

```bash
# 1. Scaffold a project (clones a template, installs deps, optionally creates + links the remote script)
bunny scripts init

# 2. (If you skipped creation during init) create the remote script from the project directory
bunny scripts create

# 3. Build your code, then deploy the built file
bunny scripts deploy dist/index.js

# 4. Manage configuration
bunny scripts env set API_KEY "sk-..." --secret
bunny scripts deployments list
```

---

## `bunny scripts init` — Scaffold a new Edge Script project

```bash
bunny scripts init                                                                       # interactive wizard
bunny scripts init --name my-script --type standalone --template Empty --deploy-method cli
bunny scripts init --name my-script --type standalone --template Empty --deploy-method github --deploy
bunny scripts init --name my-script --skip-install                                       # skip `bun install`
bunny scripts init --repo user/my-template                                               # custom GitHub template
bunny scripts init --name my-script --template-repo https://github.com/user/my-template  # custom template (full URL)
```

Clones a starter template into a new directory, removes the template's `.git`, installs dependencies, writes `.bunny/script.json` (with the script type), and optionally creates + links the remote script.

### Flags

| Flag              | Alias  | Description                                                                 |
| ----------------- | ------ | --------------------------------------------------------------------------- |
| `--name`          |        | Project directory name (prompted if omitted; triggers non-interactive mode) |
| `--type`          |        | Script type: `standalone` or `middleware`                                   |
| `--template`      |        | Built-in template name (e.g. `Empty`, `Return JSON`, `Simple Middleware`)   |
| `--template-repo` | `--repo` | Git URL or GitHub `owner/repo` shorthand to use as a custom template      |
| `--deploy`        |        | Create the remote script after scaffolding (`--no-deploy` to skip)          |
| `--deploy-method` |        | `github` (GitHub Actions on push) or `cli` (manual `bunny scripts deploy`)  |
| `--skip-git`      |        | Skip `git init`                                                             |
| `--skip-install`  |        | Skip dependency installation                                               |

### Notes

- Providing `--name` switches to **non-interactive** mode: unspecified options take defaults (template `Empty`, deploy-method `cli`, no remote creation unless `--deploy`).
- `--template` and `--template-repo` are mutually exclusive.
- For `--deploy-method github`, git is auto-initialized and you must add a `SCRIPT_ID` secret to your GitHub repo before pushing (the command prints the value).
- For custom template repos, dependency installation always asks for confirmation first (a malicious template's lifecycle scripts would otherwise run silently).

### Built-in templates

| Type       | Name              | Description                          |
| ---------- | ----------------- | ------------------------------------ |
| Standalone | `Empty`           | An empty Edge Script project         |
| Standalone | `Return JSON`     | A script that returns JSON responses |
| Middleware | `Empty`           | An empty Edge Script project         |
| Middleware | `Simple Middleware` | A simple middleware example        |

---

## `bunny scripts create` — Create a remote Edge Script

```bash
bunny scripts create                                          # use current directory name, create pull zone, link
bunny scripts create my-script --type middleware              # explicit name + type
bunny scripts create my-script --no-pull-zone --no-link       # skip pull zone and linking
bunny scripts create my-script --pull-zone-name my-zone       # custom linked pull zone name
bunny scripts create --output json
```

Creates the remote script (without scaffolding a project). Use it when you already have a project — e.g. you ran `init` without `--deploy`, or you're in a custom directory and need a remote script before `deploy`.

### Flags

| Flag               | Default        | Description                                                          |
| ------------------ | -------------- | -------------------------------------------------------------------- |
| `name` (positional) | current dir name | Script name                                                       |
| `--type`           | manifest/prompt | Script type: `standalone` or `middleware`                           |
| `--pull-zone`      | `true`         | Create a linked pull zone. Use `--no-pull-zone` to skip.            |
| `--pull-zone-name` |                | Name for the linked pull zone                                       |
| `--link`           | `true`         | Link this directory via `.bunny/script.json`. Use `--no-link` to skip. |

Script type resolves: `--type` flag → `.bunny/script.json` manifest → interactive prompt → error. In `--output json` mode, prompts are suppressed, so `--type` is required if no manifest exists.

---

## `bunny scripts deploy` — Deploy code to an Edge Script

```bash
bunny scripts deploy dist/index.js                # upload + publish (linked script)
bunny scripts deploy dist/index.js --skip-publish # upload code without publishing a release
bunny scripts deploy dist/index.js 12345          # deploy to a specific script ID
bunny scripts deploy dist/index.js --output json
```

Reads the specified built file and uploads it as the script code, then publishes it as a live release **by default**. Pass `--skip-publish` to upload without going live.

| Flag             | Default | Description                                       |
| ---------------- | ------- | ------------------------------------------------- |
| `file` (positional) | —     | Path to the built file to deploy (required)       |
| `id` (positional)   | linked | Edge Script ID (uses linked script if omitted)    |
| `--skip-publish` | `false` | Upload code without publishing it as a live release |

The `<file>` is the **built/bundled** output (e.g. `dist/index.js`), not your source — bundle first if your project has a build step. After a published deploy, the live hostname is printed.

---

## `bunny scripts list` — List all Edge Scripts

```bash
bunny scripts list                 # table
bunny scripts ls                   # alias
bunny scripts list --output json
```

Lists standalone and middleware scripts (sorted by name) with their linked pull zones. Columns: ID, Name, Type, Pull Zone.

---

## `bunny scripts show` — Show Edge Script details

```bash
bunny scripts show                 # linked script
bunny scripts show 12345           # specific ID
bunny scripts show --output json
```

Displays metadata (ID, Name, Type, hostnames, current release, last modified, monthly requests/CPU time/cost), linked pull zones, and environment variables.

---

## `bunny scripts link` — Link the current directory to a script

```bash
bunny scripts link                 # interactive selection from all scripts
bunny scripts link --id 12345      # direct link by ID
bunny scripts link --id 12345 --output json
```

Writes `{ id, name, scriptType }` to `.bunny/script.json` so subsequent commands resolve the target automatically. With `--id`, the script is fetched and linked immediately; otherwise an interactive list is shown.

---

## `bunny scripts delete` — Delete an Edge Script

```bash
bunny scripts delete 12345                       # double confirmation
bunny scripts delete                             # delete linked script
bunny scripts delete 12345 --force               # skip both prompts
bunny scripts delete 12345 --force --output json
```

**Destructive and irreversible** — the script and all its deployments, environment variables, and secrets are permanently removed.

| Flag      | Short | Default | Description               |
| --------- | ----- | ------- | ------------------------- |
| `--force` | `-f`  | `false` | Skip confirmation prompts |

### Confirmation flow

1. Yes/no confirmation: "Delete Edge Script [name] ([id])? This cannot be undone."
2. Type the script name to verify (skipped with `--force`)

---

## `bunny scripts docs` — Open Edge Scripts documentation

```bash
bunny scripts docs
```

Opens the Edge Scripting documentation in the default browser.

---

## Deployments

### `bunny scripts deployments list` — List deployments (releases)

```bash
bunny scripts deployments list           # linked script
bunny scripts deployments list 12345     # by ID
bunny scripts deployments ls             # alias
bunny scripts deployments list --output json
```

Lists each release (excluding deleted ones) with ID, Status (● Live / ○ Archived), Author, Released date, and Published date. If a release is live and the script has a linked pull zone, the hostname is printed.

---

## Environment variables & secrets

Commands live under `bunny scripts env`. Variable names are automatically uppercased. **Variables** store plain values; **secrets** are encrypted and their values cannot be read back from the API.

### `bunny scripts env list` — List variables and secrets

```bash
bunny scripts env list           # linked script
bunny scripts env list 12345     # by ID
bunny scripts env ls             # alias
bunny scripts env list --output json
```

Merges plain variables and secrets into one table (sorted by name). Columns: ID, Name, Value, Secret. Secret values show blank.

### `bunny scripts env set` — Set a variable or secret

```bash
bunny scripts env set MY_VAR "hello world"        # plain variable
bunny scripts env set API_KEY "sk-..." --secret   # encrypted secret
bunny scripts env set                             # interactive (prompts for name, value, secret?)
bunny scripts env set MY_VAR "value" --id 12345   # specific script
```

| Flag       | Description                                                  |
| ---------- | ----------------------------------------------------------- |
| `name` (positional)  | Variable name (uppercased automatically)          |
| `value` (positional) | Variable value (prompted if omitted)              |
| `--id`     | Edge Script ID (uses linked script if omitted)              |
| `--secret` | Store as an encrypted secret (value is masked during input) |

Errors if a name already exists as the **opposite** type — remove it first to switch a variable to a secret or vice versa.

### `bunny scripts env remove` — Remove a variable or secret

```bash
bunny scripts env remove MY_VAR          # by name (with confirmation)
bunny scripts env remove                 # interactive select
bunny scripts env remove MY_VAR --force  # skip confirmation
bunny scripts env rm MY_VAR -f           # alias
bunny scripts env remove MY_VAR --id 12345
```

| Flag      | Short | Default | Description                                    |
| --------- | ----- | ------- | ---------------------------------------------- |
| `name` (positional) | — | prompt | Variable or secret name to remove            |
| `--id`    |       | linked  | Edge Script ID (uses linked script if omitted) |
| `--force` | `-f`  | `false` | Skip confirmation prompt                       |

### `bunny scripts env pull` — Pull variables to a local `.env`

```bash
bunny scripts env pull           # linked script
bunny scripts env pull 12345     # by ID
bunny scripts env pull --force   # overwrite existing file without prompting
```

Writes plain variables as `NAME=VALUE` lines to `.bunny/.env` (mode `0600`). **Secrets are not included** — their values cannot be read from the API.

| Flag      | Short | Default | Description                                    |
| --------- | ----- | ------- | ---------------------------------------------- |
| `id` (positional) | — | linked | Edge Script ID (uses linked script if omitted) |
| `--force` | `-f`  | `false` | Overwrite existing `.env` without prompting    |

---

## Anti-Patterns

- **Deploying source instead of the build**: `bunny scripts deploy` expects the bundled output file (e.g. `dist/index.js`). Run your build step first.
- **Expecting secrets back from `env pull`**: Only plain variables are pulled. Secret values are write-only via the API.
- **Forgetting `--type` in JSON/non-interactive mode**: With `--output json` (or no manifest and no TTY), the type prompt is suppressed — pass `--type standalone|middleware` explicitly.
- **Committing `.bunny/`**: The manifest and pulled `.env` are per-developer state. Keep `.bunny/` gitignored (`init` does this for you).
