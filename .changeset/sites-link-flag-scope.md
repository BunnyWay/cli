---
"@bunny.net/cli": patch
---

fix(sites): `--link` is now only accepted by the commands that can act on it (`deploy`, `show`, `deployments list/publish`, `upgrade-router`, `ci init`), where an explicit `--link` also links a site resolved from `--site` or `bunny.jsonc`, including under `--output json`; `open`, `ssl`, `delete` and `deployments prune` no longer advertise a flag they ignored
