---
"@bunny.net/tools": minor
"@bunny.net/cli": minor
---

Add `@bunny.net/tools`, typed bunny.net tool definitions shared by the CLI and tool hosts, and move `registries` onto it: `add`/`update` gain `--type` and derive it from `--server` (ghcr.io and docker.io need one), `--output json` returns the normalized registry shape
