---
"@bunny.net/cli": patch
---

feat(scripts/init): replace the misleading "How will you deploy?" two-choice prompt with a single yes/no "Enable continuous integration with GitHub Actions?". Both deploy paths (CLI and GitHub Actions) remain available either way — the choice now only controls whether the template's `.github/` workflow is kept. The `.changeset/` directory is removed from every template (bunny scripts don't use it). `--deploy-method` is replaced by `--github-actions` / `--no-github-actions`.
