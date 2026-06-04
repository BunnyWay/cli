---
"@bunny.net/cli": patch
---

Cancelling an interactive selection prompt now exits non-zero so scripts and CI can tell a cancelled command apart from a successful one. Previously `db link`, `db regions update`, and `scripts env remove` printed a "Cancelled." line and exited `0` when you aborted the picker with Ctrl-C/Esc, making a no-op indistinguishable from success. They now exit `1` (and emit a proper `{"error":…}` payload under `--output json`), matching `scripts link`, `apps link`, and the shared `resolveDbId` selection prompt. Declining a confirmation ("Delete?", "Replace?") still exits `0` — that's a deliberate answer, not an abort.
