# Edge Scripts Commands

All Edge Scripts commands live under `bunny scripts`. They manage serverless scripts that run on bunny.net's edge, either **Standalone** (handle requests independently) or **Middleware** (process requests before or after an origin).

Most commands accept an optional `id` (the numeric Edge Script ID). When omitted, the ID is resolved from the linked script in `.bunny/script.json`, written by `bunny scripts link`, `bunny scripts create`, or `bunny scripts init`. If no link exists and no ID is passed, the command errors. The manifest is gitignored, since it's per-developer state rather than shared.

## Typical workflow

```bash
bunny scripts init                 # scaffold a project from a template
cd my-edge-script
bunny scripts deploy dist/index.js # build, then upload + publish
bunny scripts show                 # check status, hostname, usage
```

Or, starting from an existing project:

```bash
bunny scripts create               # create the remote script + link this dir
bunny scripts deploy dist/index.js
```

---

## `bunny scripts init`: Scaffold a new project from a template

```bash
bunny scripts init                                                                          # interactive wizard
bunny scripts init --name my-script --type standalone --template Empty --no-github-actions  # non-interactive
bunny scripts init --name my-script --type standalone --template Empty --deploy             # scaffold + create remote script
bunny scripts init --name my-script --skip-install                                          # skip dependency install
bunny scripts init --repo user/my-template                                                  # custom template (owner/repo shorthand)
bunny scripts init --name my-script --template-repo https://github.com/user/my-template     # custom template (full URL)
```

### Flags

| Flag               | Alias    | Description                                                                              |
| ------------------ | -------- | ---------------------------------------------------------------------------------------- |
| `--name`           |          | Project directory name (prompted if omitted). Providing it implies non-interactive mode. |
| `--type`           |          | Script type: `standalone` or `middleware`                                                |
| `--template`       |          | Built-in template name (e.g. `Empty`, `Return JSON`, `Simple Middleware`)                |
| `--template-repo`  | `--repo` | Git repo URL or GitHub `owner/repo` shorthand to clone as the template                   |
| `--deploy`         |          | Create the script on bunny.net after scaffolding                                         |
| `--github-actions` |          | Keep the template's GitHub Actions CI workflow. Use `--no-github-actions` to remove it.  |
| `--skip-git`       |          | Skip `git init`                                                                          |
| `--skip-install`   |          | Skip dependency installation                                                             |

### Behavior notes

- Clones the template, removes `.git` (you start fresh) and `.changeset/`, then optionally installs dependencies and runs `git init`.
- Package manager is auto-detected from the template's lockfile, falling back to whatever is on `PATH` (bun, npm, pnpm, yarn).
- Custom template repos always prompt before installing dependencies, because a malicious template's lifecycle scripts (preinstall/postinstall) would otherwise run silently. `--template` and `--template-repo` are mutually exclusive.
- A custom `--template-repo` defaults the script type to `standalone` unless `--type` is given.
- With `--deploy` and `--github-actions`, the command prints the `SCRIPT_ID` secret to add to your GitHub repo for CI deploys.
- Adds `.bunny/` to `.gitignore` when initializing git.

---

## `bunny scripts create`: Create a remote Edge Script

Use this when you already have a project (for example, you ran `init` without `--deploy`) and need a remote script before deploying.

```bash
bunny scripts create                                          # current dir name, creates pull zone, links dir
bunny scripts create my-script --type middleware              # explicit name + type
bunny scripts create my-script --no-pull-zone --no-link       # skip pull zone + linking
bunny scripts create my-script --pull-zone-name my-zone       # name the linked pull zone
bunny scripts create --output json                            # non-interactive
```

### Flags

| Flag               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--type`           | Script type: `standalone` or `middleware` (prompted if omitted and interactive)          |
| `--pull-zone`      | Create a linked pull zone (default: `true`). Use `--no-pull-zone` to skip.               |
| `--pull-zone-name` | Name for the linked pull zone                                                            |
| `--link`           | Link this directory via `.bunny/script.json` (default: `true`). Use `--no-link` to skip. |

The script name defaults to the current directory name. Script type resolves in order: an explicit `--type`, then an existing `.bunny/script.json`, then an interactive prompt, otherwise it errors. In `--output json` mode, prompts are suppressed and the output includes `id`, `name`, `scriptType`, `hostname`, and `linked`.

---

## `bunny scripts deploy`: Upload and publish code

```bash
bunny scripts deploy dist/index.js                  # upload + publish to linked script
bunny scripts deploy dist/index.js 12345            # deploy to a specific script
bunny scripts deploy dist/index.js --skip-publish   # upload without publishing
```

### Arguments & flags

| Arg / Flag       | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `<file>`         | Path to the built file to deploy (**required**)             |
| `[id]`           | Edge Script ID (uses linked script if omitted)              |
| `--skip-publish` | Upload the code as a new release without publishing it live |

`deploy` does not build. Point it at an already-built file such as `dist/index.js`. It uploads the file as the script code, publishes by default, and on success prints the live hostname. Use `--skip-publish` to stage a release you publish later.

---

## `bunny scripts list`: List all Edge Scripts

```bash
bunny scripts list                    # table
bunny scripts ls                      # alias
bunny scripts list --output json
```

Lists standalone and middleware scripts (DNS scripts are excluded). Columns: ID, Name, Type, Pull Zone.

---

## `bunny scripts show`: Show script details

```bash
bunny scripts show                    # linked script
bunny scripts show 12345              # specific script
bunny scripts show --output json
```

Displays metadata (ID, name, type, hostnames, current release, last modified), monthly usage (requests, CPU time, cost), linked pull zones, and environment variables.

---

## `bunny scripts link`: Link the current directory to a script

```bash
bunny scripts link                    # interactive selection from all scripts
bunny scripts link --id 12345         # direct link by ID
bunny scripts link --id 12345 --output json
```

Writes the script ID, name, and type to `.bunny/script.json` so subsequent commands resolve the script automatically. With `--id`, links immediately; otherwise lists all scripts to choose from.

---

## `bunny scripts delete`: Delete a script (destructive)

```bash
bunny scripts delete 12345            # double confirmation
bunny scripts delete                  # delete linked script
bunny scripts delete 12345 --force    # skip confirmations
bunny scripts delete 12345 --force --output json
```

| Flag      | Short | Default | Description               |
| --------- | ----- | ------- | ------------------------- |
| `--force` | `-f`  | `false` | Skip confirmation prompts |

This is destructive and irreversible. It removes the script and all its deployments, variables, and secrets. Without `--force`, it requires two confirmations: a yes/no prompt, then typing the script name to verify.

---

## `bunny scripts docs`: Open Edge Scripts documentation

```bash
bunny scripts docs
```

Opens the Edge Scripts documentation in the default browser.

---

## Environment variables & secrets: `bunny scripts env`

Variables are stored in plaintext and readable back from the API. Secrets are encrypted and their values can never be read back. Names are automatically uppercased. A name can be a variable or a secret but not both, so setting one when the other exists errors.

### `bunny scripts env list`: List variables and secrets

```bash
bunny scripts env list                # linked script
bunny scripts env ls 12345            # alias, specific script
bunny scripts env list --output json
```

Merges plain variables and secrets into one table (ID, Name, Value, Secret). Secret values display blank.

### `bunny scripts env set`: Set a variable or secret

```bash
bunny scripts env set MY_VAR "hello world"     # plain variable
bunny scripts env set API_KEY "sk-..." --secret # encrypted secret
bunny scripts env set                            # interactive
bunny scripts env set MY_VAR "value" --id 12345  # specific script
```

| Flag       | Description                                               |
| ---------- | --------------------------------------------------------- |
| `--id`     | Edge Script ID (uses linked script if omitted)            |
| `--secret` | Store as an encrypted secret rather than a plain variable |

Prompts for missing name, value, and secret flag interactively (secret values are masked on input).

### `bunny scripts env remove`: Remove a variable or secret

```bash
bunny scripts env remove MY_VAR       # by name
bunny scripts env remove              # interactive select
bunny scripts env rm MY_VAR -f        # alias + skip confirmation
bunny scripts env remove MY_VAR --id 12345
```

| Flag      | Short | Default | Description                                    |
| --------- | ----- | ------- | ---------------------------------------------- |
| `--id`    |       |         | Edge Script ID (uses linked script if omitted) |
| `--force` | `-f`  | `false` | Skip confirmation prompt                       |

Name matching is case-insensitive. With no name, shows an interactive select list.

### `bunny scripts env pull`: Pull variables to a local `.env`

```bash
bunny scripts env pull                # linked script
bunny scripts env pull 12345          # specific script
bunny scripts env pull --force        # overwrite without prompting
```

| Flag      | Short | Default | Description                                    |
| --------- | ----- | ------- | ---------------------------------------------- |
| `--force` | `-f`  | `false` | Overwrite an existing `.env` without prompting |

Writes each variable as `NAME=VALUE` to `.bunny/.env` (mode `0600`). Secrets are never included, because their values cannot be read from the API. Prompts before overwriting an existing file unless `--force` is passed.

---

## Deployments: `bunny scripts deployments`

### `bunny scripts deployments list`: List releases

```bash
bunny scripts deployments list        # linked script
bunny scripts deployments ls 12345    # alias, specific script
bunny scripts deployments list --output json
```

Lists releases (deployments) for a script: ID, Status (● Live or ○ Archived), Author, Released, Published. Deleted releases are excluded. If a release is live and the script has a linked pull zone, the hostname is printed at the end.

---

## Anti-Patterns

- **Expecting `deploy` to build**: `deploy` uploads an already-built file. Build first, then point `deploy` at the output (e.g. `dist/index.js`).
- **Expecting to read secrets back**: secret values are write-only. `env list` shows them blank and `env pull` omits them, so keep the source values elsewhere (a secret manager) if you need them.
- **Forgetting `--force` in CI/CD**: `delete`, `env remove`, and `env pull` prompt interactively. Pass `--force` in non-TTY pipelines, and `--output json` to suppress follow-up prompts on `create` and `init`.
- **Trusting custom templates blindly**: `--template-repo` clones and (after a prompt) runs install scripts from arbitrary repos. Review the template before installing.
