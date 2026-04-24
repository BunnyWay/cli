---
"@bunny.net/cli": minor
---

Add `--repo` alias for `--template-repo` on `bunny scripts init` and accept GitHub `owner/repo` shorthand. When a custom template repo is given without `--type`, the script type now defaults to `standalone`.

After a script is created by `bunny scripts create` (and `bunny scripts init --deploy`), the CLI now prompts to open the linked pull zone hostname in the browser. Declining shows a reminder to make local changes and run `bunny scripts deploy <file>`.
