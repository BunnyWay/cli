# Edge Scripts Commands

All Edge Script commands live under `bunny scripts`. Most accept an optional `SCRIPT_ID`. When omitted, the ID is resolved in this order:

1. Explicit `SCRIPT_ID` — a trailing `[id]` positional on most commands, or the `--id` flag on `env set` / `env remove` (which already use positionals for the variable name/value)
2. `.bunny/script.json` manifest (written by `bunny scripts link`, `bunny scripts create`, or `bunny scripts init --deploy`)
3. Interactive prompt (suppressed in `--output json` mode — pass an ID or link the directory in CI)

When the script is chosen via the interactive prompt, these commands (`show`, `stats`, `env`, `deployments`) offer to link the directory to it. Pass `--link` to link without the prompt, or `--no-link` to skip it.

## Typical workflows

```bash
# New project from scratch: scaffold, create remote script, deploy
bunny scripts init --name my-script --type standalone --template Empty --no-github-actions --deploy
cd my-script
bunny scripts deploy dist/index.js

# Existing project: create the remote script, then deploy
bunny scripts create            # links .bunny/script.json + creates a pull zone
bunny scripts deploy dist/index.js

# Existing remote script: link the directory first
bunny scripts link
bunny scripts deploy dist/index.js
```

---

## `bunny scripts init` — Scaffold a project from a template

```bash
bunny scripts init                                                                       # interactive wizard
bunny scripts init --name my-script --type standalone --template Empty --no-github-actions --deploy
bunny scripts init --name my-script --type standalone --template Empty --github-actions --deploy
bunny scripts init --repo owner/my-template                                              # custom template (shorthand)
bunny scripts init --template-repo https://github.com/owner/my-template                  # custom template (full URL)
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

- `--repo`/`--template-repo` without `--type` defaults to `standalone`.
- With `--github-actions`, git is initialized automatically and the `SCRIPT_ID` to add as a GitHub repo secret is printed after script creation.
- The interactive wizard offers an optional custom domain after creating the script (same DNS + HTTPS flow as `domains add`). If the domain is in one of the account's Bunny DNS zones, it offers — after confirmation — to add or repoint the DNS record, then issues SSL straight away since DNS is already live on bunny's resolvers.

---

## `bunny scripts create` — Create a remote Edge Script

Creates the script on bunny.net without scaffolding a project. Use when a local project already exists and needs a remote script before `deploy`.

```bash
bunny scripts create                                  # current directory name + link
bunny scripts create my-script --type middleware
bunny scripts create my-script --no-pull-zone --no-link
bunny scripts create my-script --domain shop.example.com
```

| Flag               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--type`           | Script type: `standalone` or `middleware` (defaults to manifest, prompts if interactive) |
| `--pull-zone`      | Create a linked pull zone (default: true). Use `--no-pull-zone` to skip.                 |
| `--pull-zone-name` | Name for the linked pull zone                                                            |
| `--link`           | Link this directory to the new script (default: true). Use `--no-link` to skip.          |
| `--domain`         | Add a custom domain to the new script's pull zone (prompted when interactive)            |

---

## `bunny scripts deploy` — Upload and publish code

```bash
bunny scripts deploy dist/index.js                    # deploy and publish
bunny scripts deploy dist/index.js --skip-publish     # upload without publishing
bunny scripts deploy dist/index.js 12345              # target a specific script
```

| Flag             | Description                    |
| ---------------- | ------------------------------ |
| `--skip-publish` | Upload code without publishing |

After publishing, the live URL and any custom domains are printed. The last deployment always wins, whether triggered by GitHub Actions or a manual CLI deploy.

---

## `bunny scripts link` — Link the current directory

Writes `.bunny/script.json` so subsequent commands resolve the script without an ID.

```bash
bunny scripts link                                    # interactive selection
bunny scripts link --id <script-id>                   # non-interactive
```

---

## `bunny scripts list` / `show`

```bash
bunny scripts list                                    # all scripts (alias: ls)
bunny scripts list --output json
bunny scripts show <script-id>                        # details incl. hostnames + SSL status
bunny scripts show                                    # linked script
```

---

## `bunny scripts stats` — Usage statistics

Request, CPU, and cost totals plus a per-bucket requests-served bar chart (text mode). Defaults to the last 30 days. With no ID and no link, prompts to pick a script and offers to link the directory; in `--output json` mode it errors instead.

```bash
bunny scripts stats
bunny scripts stats 12345 --from 2026-05-01 --to 2026-05-31
bunny scripts stats 12345 --hourly
bunny scripts stats 12345 --output json
bunny scripts stats --no-link                         # interactive pick without the link prompt
```

| Flag       | Description                                                                        |
| ---------- | ---------------------------------------------------------------------------------- |
| `--from`   | Start date (YYYY-MM-DD); defaults to 30 days ago                                   |
| `--to`     | End date (YYYY-MM-DD); defaults to today                                           |
| `--hourly` | Group statistics by hour instead of by day                                         |
| `--link`   | After an interactive pick, link the directory (use `--no-link` to skip the prompt) |

---

## `bunny scripts delete` — Delete a script

Requires double confirmation (or `--force`).

```bash
bunny scripts delete <script-id>
bunny scripts delete                                  # linked script
bunny scripts delete <script-id> --force
```

---

## Deployments

### `bunny scripts deployments list`

```bash
bunny scripts deployments list                        # linked script (alias: ls)
bunny scripts deployments list <script-id>
bunny scripts deployments list --output json
```

### `bunny scripts deployments publish` — Roll back to a past release

Re-publishes an earlier release by its release ID (from `deployments list`) without touching the current code.

```bash
bunny scripts deployments publish <release-id>
bunny scripts deployments publish <release-id> <script-id>
bunny scripts deployments publish <release-id> --force
```

| Flag      | Description                                                 |
| --------- | ----------------------------------------------------------- |
| `--force` | Skip the confirmation prompt                                |
| `--link`  | After an interactive pick, link the directory to the script |

---

## Environment variables

All `env` subcommands default to the linked script. `env list` and `env pull` take a trailing `[id]`; `env set` and `env remove` use `--id <script-id>` (their positionals are the variable name and value). All accept `--link` (see the resolution note above).

### `bunny scripts env list`

```bash
bunny scripts env list                                # alias: ls
bunny scripts env list --output json
```

### `bunny scripts env set`

Variable names are uppercased. Runs interactively when arguments are omitted.

```bash
bunny scripts env set MY_VAR value
bunny scripts env set API_KEY secret-value --secret   # encrypted secret
```

### `bunny scripts env remove`

Interactive picker when no name is given; confirms unless `--force`.

```bash
bunny scripts env remove MY_VAR
bunny scripts env rm MY_VAR -f
```

### `bunny scripts env pull`

Pull environment variables to a local `.env` file.

```bash
bunny scripts env pull
bunny scripts env pull --force                        # overwrite existing .env without prompting
```

---

## Custom domains

A script's domains live on its linked pull zone — these commands operate on that pull zone. Pass a trailing `[id]` (or `--id`) to target a non-linked script, and `--pull-zone <id>` when a script has multiple linked zones. (`bunny scripts hostnames` is a hidden alias.)

### `bunny scripts domains add`

SSL is **not** requested by default — a free certificate can only be issued once DNS points at bunny.net, so the command prints the `CNAME` record to create. Interactively it offers to wait for DNS propagation (up to 10 minutes) and issues the certificate automatically.

```bash
bunny scripts domains add shop.example.com            # print CNAME, optionally wait
bunny scripts domains add shop.example.com --wait     # wait for DNS, then enable HTTPS — no prompts
bunny scripts domains add shop.example.com --ssl      # request SSL now (DNS must already point at bunny.net)
bunny scripts domains add shop.example.com --ssl --no-force-ssl
bunny scripts domains add shop.example.com 12345      # non-linked script
```

| Flag             | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `--ssl`          | Issue a free SSL certificate now and force HTTPS (requires DNS pointed) |
| `--wait`         | Wait for DNS to point at bunny.net (up to 10 minutes), then issue SSL   |
| `--no-force-ssl` | When issuing SSL, keep serving HTTP instead of redirecting to HTTPS     |
| `--pull-zone`    | Pull zone ID (required if the script has multiple linked zones)         |

### `bunny scripts domains ssl`

Request a free SSL certificate after DNS points at bunny.net. HTTP redirects to HTTPS by default.

```bash
bunny scripts domains ssl shop.example.com
bunny scripts domains ssl shop.example.com --no-force-ssl
```

### `bunny scripts domains list` / `remove`

```bash
bunny scripts domains list                            # domains with SSL + Force SSL status (alias: ls)
bunny scripts domains remove shop.example.com         # system hostnames cannot be removed
bunny scripts domains remove shop.example.com --force
```

---

## `bunny scripts docs`

Open the Edge Scripts documentation in your browser.

```bash
bunny scripts docs
```
