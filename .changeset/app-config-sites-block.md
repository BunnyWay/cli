---
"@bunny.net/app-config": patch
---

feat: optional top-level `sites` block (`name`, `dir`, `build`) in the bunny.jsonc schema, consumed by `bunny sites deploy` for the default deploy directory and build command. Exported as `SiteConfigSchema`/`SiteConfig`; the generated JSON Schema includes the new block.
