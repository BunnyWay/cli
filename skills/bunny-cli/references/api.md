# API Command

## `bunny api` — Make raw authenticated API requests

**Use `bunny api` when a CLI command doesn't exist for what you need.** Provides direct access to the bunny.net REST API with automatic authentication.

```bash
bunny api GET /user                                    # get current user
bunny api GET /pullzone                                # list pull zones
bunny api GET /database/v2/databases                   # list databases
bunny api POST /database/v2/databases --body '{"name":"test","storage_region":"DE","primary_regions":["DE"]}'
bunny api DELETE /dnszone/12345                         # delete a resource
```

## Syntax

```
bunny api METHOD PATH [--body BODY]
```

### Positional Arguments

| Argument | Required | Description                                                     |
| -------- | -------- | --------------------------------------------------------------- |
| `METHOD` | Yes      | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`            |
| `PATH`   | Yes      | API endpoint path (e.g., `/pullzone`, `/database/v2/databases`) |

### Flags

| Flag     | Short | Description       |
| -------- | ----- | ----------------- |
| `--body` | `-b`  | JSON request body |

## Request Body

The body can come from three sources (in priority order):

1. `--body` flag: `bunny api POST /path --body '{"key":"value"}'`
2. STDIN (if not a TTY and method is not GET): `echo '{"key":"value"}' | bunny api POST /path`
3. No body (default for GET requests)

The body must be valid JSON — the command validates it before sending.

## Headers

All requests automatically include:

- `AccessKey: {apiKey}` — from profile or `--api-key` flag
- `User-Agent: bunny-cli/{VERSION}`
- `Accept: application/json`
- `Content-Type: application/json` (when body is provided)

## Output

- Always outputs JSON (pretty-printed with 2-space indent)
- On error: extracts message from response fields (`detail`, `Message`, `title`) or falls back to HTTP status text
- In verbose mode (`-v`): logs the request method, URL, body, and response status

## Examples

```bash
# List all pull zones
bunny api GET /pullzone

# Get a specific pull zone
bunny api GET /pullzone/12345

# Create a DNS zone
bunny api POST /dnszone --body '{"Domain":"example.com"}'

# Pipe body from a file
cat payload.json | bunny api POST /database/v2/databases

# Use with a specific profile
bunny api GET /user -p staging

# Verbose mode to debug requests
bunny api GET /pullzone -v
```
