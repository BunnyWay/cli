# Sandbox Commands

All sandbox commands live under `bunny sandbox`. Each sandbox is a fully isolated Ubuntu container (Bunny Magic Containers) with Node.js, Bun, Python, and Claude Code pre-installed. A 10 GB persistent volume is mounted at `/workplace`, the default working directory; relative remote paths resolve against it.

Sandbox credentials (app ID, hostname, SSH endpoint, agent token) are stored in the local config (`~/.config/bunnynet.json`), so commands reference sandboxes by name.

Claude Code is pre-installed but needs the user's own Anthropic credentials: bake an API key in at create time (`-e ANTHROPIC_API_KEY=...` or `--env-file .env`), set it later with `bunny sandbox env set`, or run `claude` inside the sandbox and complete the login prompt. Credentials persist for the life of the sandbox.

## Typical workflows

```bash
# Create, run a command, expose a dev server, tear down
bunny sandbox create my-sandbox -e ANTHROPIC_API_KEY=sk-ant-...
bunny sandbox exec my-sandbox -- bun install
bunny sandbox url add my-sandbox 3000        # public HTTPS URL for port 3000
bunny sandbox delete my-sandbox --force

# Move files in and out
bunny sandbox cp ./app.js my-sandbox:app.js  # relative paths resolve against /workplace
bunny sandbox cp my-sandbox:out.log ./out.log

# Interactive work
bunny sandbox ssh my-sandbox
```

---

## `bunny sandbox create`

Create and start a new sandbox. Waits for the container's SSH port to become reachable. Prompts for a name when omitted (in `--output json` mode the positional is required).

```bash
bunny sandbox create                                   # interactive: prompts for a name
bunny sandbox create my-sandbox
bunny sandbox create my-sandbox --region NY
bunny sandbox create my-sandbox -e NODE_ENV=production --env-file .env
bunny sandbox create my-sandbox -e ANTHROPIC_API_KEY=sk-ant-...   # ready for Claude Code
```

| Flag         | Alias | Description                                       | Default |
| ------------ | ----- | ------------------------------------------------- | ------- |
| `--region`   |       | Region ID to deploy in (e.g. `AMS`, `NY`, `LA`)   | `AMS`   |
| `--env`      | `-e`  | Environment variable as `KEY=VALUE` (repeatable)  |         |
| `--env-file` |       | Load environment variables from a dotenv file     |         |

Variables set at creation are baked into the container and persist across restarts; `--env` overrides `--env-file`. Output shows the app ID, public HTTPS hostname, and SSH address.

---

## `bunny sandbox list` / `delete`

```bash
bunny sandbox list                    # sandboxes in local config (alias: ls)
bunny sandbox delete my-sandbox       # destroys the underlying Magic Containers app
bunny sandbox rm my-sandbox -f        # alias; --force skips confirmation
```

---

## `bunny sandbox exec`

Run a shell command inside a sandbox over SSH. Defaults to `/workplace`. Exit code is propagated; use `--` before the command so its flags are not consumed by the CLI.

```bash
bunny sandbox exec my-sandbox ls -la
bunny sandbox exec my-sandbox --cwd /tmp env
bunny sandbox exec my-sandbox --env DEBUG=1 -- node app.js
bunny sandbox exec my-sandbox --timeout 30 -- bun run build   # exit 124 on timeout
```

| Flag         | Description                                                     | Default      |
| ------------ | --------------------------------------------------------------- | ------------ |
| `--cwd`      | Working directory inside the sandbox                            | `/workplace` |
| `--env`      | Temporary environment variable as `KEY=VALUE` (repeatable)      |              |
| `--env-file` | Load temporary environment variables from a dotenv file         |              |
| `--timeout`  | Close the SSH connection and exit `124` after this many seconds |              |

Variables passed here apply to that single command only. For persistent variables, use `bunny sandbox env`.

---

## `bunny sandbox ssh`

Open a full interactive SSH session (bash at `/workplace`). `exit` or Ctrl-D closes it.

```bash
bunny sandbox ssh my-sandbox
bunny sandbox ssh my-sandbox -e DEBUG=1 --env-file .env   # session-only variables
```

---

## `bunny sandbox cp`

Copy a single file between the local machine and a sandbox over SFTP. Exactly one path must be `<sandbox>:<path>`; relative remote paths resolve against `/workplace`. Uploads preserve the local Unix mode. Directory and sandbox-to-sandbox copies are not supported.

```bash
bunny sandbox cp ./app.js my-sandbox:/workplace/app.js
bunny sandbox cp ./app.js my-sandbox:app.js            # relative to /workplace
bunny sandbox cp ./app.js my-sandbox:/workplace/src/   # trailing slash keeps the filename
bunny sandbox cp my-sandbox:/workplace/out.log ./logs/
```

---

## `bunny sandbox files`

Inspect files over SFTP. A bare sandbox name targets `/workplace`; use `<sandbox>:<path>` for a specific directory.

```bash
bunny sandbox files list my-sandbox               # alias: ls
bunny sandbox files ls my-sandbox:src
bunny sandbox files ls my-sandbox --output json   # name, type, size, mode
```

---

## Public URLs

Expose ports running inside a sandbox as public HTTPS endpoints (for dev servers and APIs).

### `bunny sandbox url add`

Waits until the URL is provisioned and prints it.

```bash
bunny sandbox url add my-sandbox 3000                  # endpoint named "port-3000"
bunny sandbox url add my-sandbox 8080 --label my-api
```

### `bunny sandbox url list` / `delete`

```bash
bunny sandbox url list my-sandbox                      # user-created endpoints (alias: ls)
bunny sandbox url delete my-sandbox port-3000
bunny sandbox url rm my-sandbox my-api -f              # alias; --force skips confirmation
```

---

## Persistent environment variables

`bunny sandbox env` manages the variables baked into the container (unlike the temporary `--env` on `exec`/`ssh`). Changing them redeploys the sandbox and restarts running processes.

### `bunny sandbox env set`

Merges with the existing set.

```bash
bunny sandbox env set my-sandbox NODE_ENV=production
bunny sandbox env set my-sandbox A=1 B=2
bunny sandbox env set my-sandbox --env-file .env
```

### `bunny sandbox env list` / `delete`

```bash
bunny sandbox env list my-sandbox                      # alias: ls (internal AGENT_TOKEN hidden)
bunny sandbox env delete my-sandbox NODE_ENV
bunny sandbox env rm my-sandbox A B                    # aliases: rm, unset
```

Unset names are reported and skipped; if none match, the command errors and nothing is redeployed.
