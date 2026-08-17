---
"@bunny.net/openapi-client": minor
---

Standalone-library DX improvements: export `authMiddleware` so custom `openapi-fetch` clients can reuse the shared auth/error-normalization middleware; add per-API subpath entrypoints (`@bunny.net/openapi-client/core`, `/compute`, `/database`, `/magic-containers`, `/origin-errors`, `/shield`, `/storage`, `/stream`) that bundle each client factory with its generated spec types (the `generated/*` paths remain for backwards compatibility); and fill in npm metadata — license (MIT, with a bundled LICENSE file), description, repository, homepage, bugs, keywords, `sideEffects: false`, and an `engines` field (Node ≥ 18).
