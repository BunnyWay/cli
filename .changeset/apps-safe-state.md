---
"@bunny.net/cli": patch
---
fix(apps): stop `apps deploy` and `apps init` from overwriting a linked app that has no `bunny.jsonc`, and keep `apps env` changes from being undone by the next deploy
