---
"@bunny.net/cli": patch
"@bunny.net/config": patch
---
fix(apps): the live app is the source of truth: `deploy` only updates container images and works without `bunny.jsonc`, `apps push` is removed in favour of `apps scale` and `apps regions set`, deploy adds missing containers and volumes without touching existing ones and warns when `bunny.jsonc` differs from the app, env is never sent by `deploy` or written by `pull` (`bunny apps env` owns it), and `bunny.jsonc` is marked experimental
