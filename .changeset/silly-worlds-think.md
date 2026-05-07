---
"@bunny.net/cli": patch
---

fix(scripts): pass `--` separator to `git clone` in `bunny scripts init` so the template repo URL is always treated as a positional argument, hardening against `git` argv injection.
