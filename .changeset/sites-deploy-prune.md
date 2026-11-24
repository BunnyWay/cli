---
"@bunny.net/config": minor
"@bunny.net/cli": minor
"@bunny.net/framework-detector": minor
---

feat(sites): `sites deploy` prunes to the live and previous deploys by default (existing sites opt in once), with `sites.keep` in bunny.jsonc and `deploy --keep`; `sites deployments prune` without `--keep` now follows the same setting and keeps only the live and previous deploys instead of the newest 5
