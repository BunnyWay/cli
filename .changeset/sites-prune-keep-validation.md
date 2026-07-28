---
"@bunny.net/cli": patch
---

fix(sites): `deployments prune --keep` now rejects non-integer and negative counts up front; `--keep abc` reached the pruner as NaN and deleted every deploy except the live and previous ones
