---
"@bunny.net/cli": minor
"@bunny.net/config": patch
---

`bunny sites deploy` deploys a `functions/` directory alongside the site; each entry becomes an Edge Script on its own URL, passed to the build as `BUNNY_FUNCTION_<NAME>_URL`. `bunny scripts deploy --bundle` bundles a source entry and its dependencies for the Deno-based edge runtime.
