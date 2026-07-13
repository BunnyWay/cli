---
"@bunny.net/cli": patch
---

fix(sandbox): `sandbox exec` now honors the documented `-- <command>` separator, and a repeatable `--env` flag no longer greedily swallows the command that follows it
