---
"@bunny.net/cli": minor
"@bunny.net/config": patch
---

`bunny sites deploy` deploys a `functions/` directory alongside the site; each entry becomes an Edge Script on its own URL, passed to the build as `BUNNY_FUNCTION_<NAME>_URL`.
