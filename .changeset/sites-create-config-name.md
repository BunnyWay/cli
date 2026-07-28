---
"@bunny.net/cli": patch
---

fix(sites): `create` falls back to `sites.name` from `bunny.jsonc` like every other sites command, instead of failing with "Site name is required." in a configured project when it can't prompt
