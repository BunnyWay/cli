---
"@bunny.net/cli": patch
---

Fix `bunny --version` failing with "Unknown argument: version". The
update-check work in a previous release switched yargs to `.version(false)`
plus a manual `--version` option, which interacts badly with strict mode.
The `--version` flag is now intercepted before yargs parses, so the latest
version is still fetched and an upgrade hint shown when outdated.
