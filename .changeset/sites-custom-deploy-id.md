---
"@bunny.net/cli": minor
---

Add `--deploy-id` to `bunny sites deploy` so a deploy can carry your own release identifier. Reusing an ID for different content asks before replacing (`--force` skips the prompt) and clears the old files first; the live deploy and the rollback target are never replaced in place
