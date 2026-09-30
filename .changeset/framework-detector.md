---
"@bunny.net/framework-detector": minor
"@bunny.net/cli": patch
---

Publish `@bunny.net/framework-detector`: the framework presets, framework and package manager detection, and the GitHub Actions workflow behind `bunny sites`, as a dependency-free package the dashboard and the Sites control plane share with the CLI. `bunny sites deploy` now hashes content the same way on every machine and in the dashboard, whatever the locale; a site's next content deploy after upgrading gets a new content hash once, so an unchanged folder is published again rather than skipped.
