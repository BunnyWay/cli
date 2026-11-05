---
"@bunny.net/cli": patch
"@bunny.net/config": patch
---
fix(apps): apply health-check probes from `bunny.jsonc`, which were silently dropped, and stop `apps push` wiping probes set in the dashboard
