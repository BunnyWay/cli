---
"@bunny.net/sandbox": minor
"@bunny.net/cli": minor
---

feat(sandbox): add environment variable support

- SDK: `Sandbox` gains `getEnv`/`setEnv`/`unsetEnv` to read and persist container env vars after creation (merges with the existing set, preserves reserved keys).
- CLI: `sandbox create`, `sandbox exec`, and `sandbox ssh` accept `-e/--env KEY=VALUE` (repeatable) and `--env-file`. Vars on `create` are persisted; on `exec`/`ssh` they are temporary for that invocation.
- CLI: new `sandbox env` namespace (`set`/`list`/`delete`) to manage persisted env vars.
