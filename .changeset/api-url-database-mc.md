---
"@bunny.net/openapi-client": minor
"@bunny.net/cli": patch
"@bunny.net/sandbox": minor
---

fix: `BUNNYNET_API_URL` (and a profile's `api_url`) no longer breaks the `db`, `apps` and `sandbox` commands: `ClientOptions` gains `apiUrl`, the root of the bunny.net API, from which Database derives `<apiUrl>/database` and Magic Containers `<apiUrl>/mc`; `baseUrl` keeps its meaning and still takes precedence; `SandboxAuth` gains `baseUrl` likewise, and its `apiUrl` is now the API root, so callers that passed the Magic Containers base (`…/mc`) should pass it as `baseUrl` instead
