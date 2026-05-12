---
"@bunny.net/cli": patch
---

Require confirmation before installing dependencies when `bunny scripts init` uses a custom template repo (`--template-repo` / `--repo`). Previously, non-interactive runs auto-ran `bun install`, which would silently execute a malicious template's lifecycle scripts (preinstall, postinstall). Built-in template behavior is unchanged. Thanks to @Swival for the report.
