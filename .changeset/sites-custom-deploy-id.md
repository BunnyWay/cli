---
"@bunny.net/cli": minor
---

Add `--deploy-id` to `bunny sites deploy` so a deploy can carry your own release identifier, and clear files a replaced deploy no longer includes. Deploys now claim their ID in site state before uploading and finalize it after, so an interrupted or concurrently raced upload is marked incomplete (shown in `deployments list`, refused by `deployments publish`, finished by re-running the deploy) instead of silently serving mixed files
