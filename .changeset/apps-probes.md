---
"@bunny.net/cli": patch
"@bunny.net/config": patch
---
fix(apps): apply health-check probes from `bunny.jsonc`, which were silently dropped, and write them back on `apps pull`
