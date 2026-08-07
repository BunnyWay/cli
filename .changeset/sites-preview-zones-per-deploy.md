---
"@bunny.net/cli": patch
---

feat(sites): every deploy gets its own preview pull zone (`sites-dpl-<id>-<suffix>.b-cdn.net`) with instant HTTPS and no custom domain or DNS setup; publishing is explicit via `--production` (the interactive first deploy offers it), custom domains become production-only, and prune/delete clean up preview zones
