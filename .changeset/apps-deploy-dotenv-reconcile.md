---
"@bunny.net/cli": minor
---

feat(apps): `deploy` now offers `.env` keys the target container doesn't set yet as a multi-select, writing accepted keys to `bunny.jsonc` as name-only pointers (values stay in `.env`); declined keys are remembered in `.bunny/app.json` so each key is asked about once, and the prompt is skipped for non-TTY runs, `--output json` and `--dry-run`
