---
"@bunny.net/cli": minor
---

`bunny registries add`/`update` gain `--type` and derive it from `--server` (ghcr.io and docker.io need one), `--output json` returns a normalized registry shape, and API keys and registry credentials are redacted from `--verbose` request traces
