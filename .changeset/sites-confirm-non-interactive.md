---
"@bunny.net/cli": patch
---

fix(sites): `delete`, `deployments publish/prune` and `domains remove` now error with a `--force` hint when there's no TTY to answer their confirmation, instead of hanging on a prompt (and writing it to stdout ahead of `--output json`)
