---
"@bunny.net/sandbox": minor
"@bunny.net/cli": patch
---

fix(sandbox): let cp copy into an existing remote directory without a trailing slash. The SDK gains a public `sandbox.stat(path)` method, and `bunny sandbox cp` now checks the destination on both sides: an existing directory (or a trailing slash) keeps the source filename instead of failing with "Failed to write".
