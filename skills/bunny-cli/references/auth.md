# Authentication

## `bunny login` — Browser-based login

Opens a browser to authenticate with bunny.net and stores the API key in a local profile.

```bash
bunny login                # interactive login, saves to "default" profile
bunny login -p staging     # save to "staging" profile
bunny login --force        # overwrite existing profile without confirmation
```

### How it works

1. Starts a local HTTP server on a random port
2. Opens `https://dash.bunny.net/auth/login` in the default browser
3. Waits up to 5 minutes for the auth callback
4. Extracts the API key and saves it to the profile
5. Fetches user details and prints a welcome message

### Flags

| Flag      | Default | Description                                     |
| --------- | ------- | ----------------------------------------------- |
| `--force` | `false` | Overwrite existing profile without confirmation |

### Notes

- If the browser doesn't open automatically, the URL is printed to the terminal
- Exits with an error if the profile already exists (use `--force` to overwrite)
- Uses `BUNNYNET_DASHBOARD_URL` env var if set (default: `https://dash.bunny.net`)

---

## `bunny auth logout` — Remove a profile

Deletes the stored API key for a profile.

```bash
bunny auth logout               # remove "default" profile (with confirmation)
bunny auth logout -p staging    # remove "staging" profile
bunny auth logout --force       # skip confirmation prompt
```

### Flags

| Flag      | Default | Description              |
| --------- | ------- | ------------------------ |
| `--force` | `false` | Skip confirmation prompt |

### Notes

- Errors if the profile doesn't exist
- Prompts "Are you sure?" before deleting (bypassed with `--force`)

---

## Custom API Endpoint

The CLI defaults to `https://api.bunny.net` but supports custom endpoints for staging or internal environments.

**Via environment variable** (takes priority over profile config):

```bash
BUNNYNET_API_URL=https://api.staging.bunny.net bunny api GET /user
```

**Via profile config** (set `api_url` in `~/.config/bunnynet.json`):

```json
{
  "profiles": {
    "staging": {
      "api_key": "...",
      "api_url": "https://api.staging.bunny.net"
    }
  }
}
```

```bash
bunny --profile staging api GET /user
```

**Precedence**: `BUNNYNET_API_URL` env var always wins over the profile's `api_url` field.

---

## Config Resolution Precedence

Authentication is resolved in this order (first wins):

1. `--api-key` flag
2. `BUNNYNET_API_KEY` environment variable
3. Profile from config file (via `--profile`, default: `default`)
4. Built-in defaults (empty API key — commands will fail)

The API base URL is resolved separately:

1. `BUNNYNET_API_URL` environment variable
2. `api_url` from the active profile
3. Default: `https://api.bunny.net`
