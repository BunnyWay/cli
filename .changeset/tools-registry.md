---
"@bunny.net/cli": patch
---

`bunny registries` moves under `bunny apps registries`, where those registries are used, leaving `bunny registry` unambiguously the bunny.net registry you push to; the list gains a `Source` column separating your connections from bunny.net's public pull-throughs and its own registry, which can no longer be updated or removed by mistake; `registry list` and `registry tags` move onto the tools layer and `list` returns a plain array of repository names under `--output json`
