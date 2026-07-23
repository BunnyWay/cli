---
"@bunny.net/config": patch
---

rename `@bunny.net/app-config` to `@bunny.net/config` and add a top-level `sites` block (`name`, `dir`, `build`) to the bunny.jsonc schema; the root `BunnyConfigSchema` makes `app` and `sites` optional so app-only, sites-only, and combined files all validate against the generated JSON Schema
