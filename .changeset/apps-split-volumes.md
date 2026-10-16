---
"@bunny.net/cli": patch
---

`bunny apps deploy` and `bunny apps push` refuse an app that mounts a volume in more than one region or scales above one instance, since each copy gets its own empty volume; pass `--allow-split-volumes` to deploy it anyway
