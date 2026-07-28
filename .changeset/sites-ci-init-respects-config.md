---
"@bunny.net/cli": patch
---

fix(sites): `ci init` now writes `sites.dir` and `sites.build` from `bunny.jsonc` into the generated workflow, so CI stops deploying the framework preset's directory while a local `sites deploy` uses the configured one; a `bunny.jsonc` below the repo root also gets a job working directory, a prefixed deploy directory, and its own lockfile as the cache path
