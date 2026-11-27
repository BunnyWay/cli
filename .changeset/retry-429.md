---
"@bunny.net/openapi-client": minor
"@bunny.net/cli": patch
---

fix(api): retry requests that get 429 Too Many Requests. Every API client except Stream (whose callers already retry) now resends a rate-limited request up to 4 times, waiting as long as `Retry-After` asks or backing off 1, 2, 4 and 8 seconds with jitter, so a burst such as `sites create`'s storage zone scan no longer stops the command halfway and leaves a storage zone without its pull zone. Cancelling a request stops the wait. `--verbose` logs each retry. Adds `maxRetries` to `ClientOptions` and exports `retryingFetch`.
