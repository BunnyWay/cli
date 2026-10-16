---
"@bunny.net/cli": patch
---

`bunny apps deploy` and `bunny apps push` refuse an app that mounts a volume in more than one region, since each region gets its own empty volume; pass `--allow-regional-volumes` to deploy it anyway
