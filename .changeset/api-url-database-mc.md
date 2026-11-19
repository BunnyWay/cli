---
"@bunny.net/openapi-client": minor
"@bunny.net/cli": patch
"@bunny.net/sandbox": patch
---

fix: `BUNNYNET_API_URL` (and a profile's `api_url`) no longer breaks the `db`, `apps` and `sandbox` commands: `ClientOptions` gains `apiUrl`, the root of the bunny.net API, from which Database derives `<apiUrl>/database` and Magic Containers `<apiUrl>/mc`; `baseUrl` keeps its meaning and still takes precedence
