---
"@bunny.net/cli": patch
---

refactor(scripts): share a common script selector across subcommands

`scripts` subcommands (env, deployments, show, stats) now use a shared selector, so they consistently accept the optional `[id]` positional and `--link` flag for targeting and linking a script.
