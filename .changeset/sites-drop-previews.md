---
"@bunny.net/cli": minor
---

feat(sites): `bunny sites deploy` now publishes straight to production. One command puts your site live: no `--production` flag to remember, no publish prompt on a fresh site, and no half-deployed state to reason about. Deploys stay immutable under their own ID, so `sites deployments publish` still rolls back to any earlier one instantly without re-uploading a byte, and `ci init` writes a leaner workflow that goes live on every push to `main` (plus `workflow_dispatch` for on-demand redeploys) and records each run in the repository's Environments. This drops the per-deploy preview URL: sites created by an earlier CLI keep their `sites-dpl-*` pull zones until you delete them with `bunny pullzone delete`
