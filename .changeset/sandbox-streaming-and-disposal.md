---
"@bunny.net/sandbox": minor
---

feat(sandbox): stream blocking command output via `onStdout`/`onStderr` callbacks, and support `using`/`await using` (Symbol.dispose/asyncDispose) to release the SSH connection when a sandbox leaves scope. Also tightens `runCommand` overloads so the return type reflects `detached` (blocking calls now correctly type as `CommandFinished`).
