---
"@bunny.net/cli": patch
"@bunny.net/config": patch
---
fix(apps): never overwrite live app settings from a missing or partial `bunny.jsonc`, keep `apps env` changes and local config through deploys and pulls, and keep legacy links when syncing config
