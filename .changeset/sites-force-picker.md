---
"@bunny.net/cli": patch
---

fix(sites): `--force` on `delete`, `deployments publish/prune` and `domains remove` now errors without an explicit or linked site instead of opening the picker, so a highlighted site can't be acted on with the confirmation already skipped
