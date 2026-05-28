---
"@bunny.net/cli": patch
---

`apps deploy` no longer prints the "Previous image / To rollback" hint after a first-time deploy. The hint is now suppressed when there was no prior app, instead of leaning on a byte-equality check between the locally pushed image ref and the canonical ref the API echoes back (which can diverge cosmetically and accidentally trigger the hint).
