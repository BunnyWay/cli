---
"@bunny.net/sandbox": patch
---

feat(sandbox): stream blocking command output via `onStdout`/`onStderr` callbacks (composes with `timeout`/`signal`), and support `using`/`await using` (Symbol.dispose/asyncDispose) to release the SSH connection when a sandbox leaves scope.
