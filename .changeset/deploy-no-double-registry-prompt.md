---
"@bunny.net/cli": patch
---

`apps deploy` no longer asks for the container registry twice on a first-run build. The registry picked during the walkthrough is now reused for the build/push step instead of being re-prompted, matching the multi-container path.
