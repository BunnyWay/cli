---
"@bunny.net/cli": patch
---

fix(sites): `deployments prune` takes the site as a positional (`prune my-site`) like its sibling subcommands, instead of rejecting it as an unknown argument; `--site` keeps working
