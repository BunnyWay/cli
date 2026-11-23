---
"@bunny.net/cli": minor
"@bunny.net/stream-import": minor
"@bunny.net/stream-import-vimeo": minor
---

fix(stream import): pace large Vimeo imports and slow down after failed fetches. An import of more than 500 Vimeo videos now runs with `--concurrency 2 --delay 10 --request-timeout 120` unless those flags are passed, and says so with an estimate of the hand-off time. A fetch Bunny fails with HTTP 422 or 503 now reads "Import failed, try slowing down the import using delay or concurrency", the run widens the gap between videos by itself once that happens, and the summary and retry offer resume more slowly. Adds `--delay`, the engine's `fetchIntervalMs`/`adaptiveThrottle` options, `SourceRejectedError`, and a `largeLibrary` profile on source plugins.
