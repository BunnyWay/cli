---
"@bunny.net/database-studio": patch
"@bunny.net/cli": patch
---

Harden `bunny db studio` against LAN, cross-origin, and credential-persistence attacks

- The studio HTTP server now binds to `127.0.0.1` instead of every interface, so LAN peers, container bridges, and VPC siblings can no longer reach it.
- `Access-Control-Allow-Origin: *` and the `OPTIONS` preflight branch were removed. The SPA is same-origin (Vite proxies `/api` in dev; prod serves the SPA and API from the same port), so no cross-origin grant is needed. Evil pages loaded in another tab can no longer read the API.
- Added a Host header allowlist (`localhost`, `127.0.0.1`, `[::1]`). Requests with any other Host are rejected with `403`, which blocks DNS-rebinding even if the server is reachable via a non-loopback address.
- The API is now gated behind a per-startup session token. The auto-opened URL carries `?token=…` once; the client exchanges it for an HttpOnly, SameSite=Strict cookie via `POST /api/auth` and scrubs the token from the URL. Every other `/api/*` request requires the cookie (timing-safe compare) or returns `401`.
- `db studio` now prints a warning and prompts for confirmation before starting, explaining that a full-access libsql token will be minted and loaded into a browser tab. A `--force`/`-f` flag skips the prompt for CI and agents.
- The libsql token minted on each run now expires after 30 minutes instead of never. This bounds the blast radius if the token ever leaves the developer's machine.
