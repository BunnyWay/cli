---
"@bunny.net/cli": minor
---

Add `bunny scripts create` command

- New `bunny scripts create [name]` command for creating an Edge Script on bunny.net without scaffolding a project. Useful when you already have a project (e.g. ran `bunny scripts init` without `--deploy`) and need a remote script before running `bunny scripts deploy`.
- Defaults the script name to the current directory name, creates a linked pull zone, and links the directory via `.bunny/script.json`.
- Flags: `--type` (`standalone` or `middleware`), `--pull-zone`/`--no-pull-zone`, `--pull-zone-name`, `--link`/`--no-link`.
- Refactored `scripts init` to share the underlying `createScript()` helper.
