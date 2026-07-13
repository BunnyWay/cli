---
"@bunny.net/cli": minor
---

feat(sites): new `bunny sites` namespace for static-site hosting. `sites create` provisions a storage zone + pull zone + middleware router per site; `sites deploy` uploads immutable deploys (git-sha or content-hash IDs, no-op when unchanged) and promotes by flipping the router's `CURRENT_DEPLOY` env var + purging the cache; `sites deployments list/publish/prune` cover rollback and cleanup; `sites domains` attaches custom domains plus a `*.preview.<domain>` wildcard for per-deploy preview URLs; `sites env` manages build-time variables merged into `sites deploy --build`; `sites link/unlink/show/upgrade/delete` round out the lifecycle. Site state lives at `_bunny/site.json` inside the storage zone (403-blocked by the router). The shared hostnames factory gains optional `onAdded`/`onRemoved` hooks.
