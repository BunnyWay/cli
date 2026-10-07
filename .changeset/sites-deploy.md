---
"@bunny.net/cli": patch
---

`bunny sites deploy` handles changed build output at the same commit, symlinks, and nested `bunny.jsonc`; failed uploads name the file, build logs stay out of `--output json`, and an unconfirmed publish warns
