---
"@bunny.net/cli": minor
---

feat(sandbox): breaking - `bunny sandbox cp` moves to `bunny sandbox files cp`, next to `bunny sandbox files list`, so every file command lives in one namespace; the old path no longer copies anything and instead errors with the exact replacement command to run, and `defineCommand` gains `hidden` for stubs like it
