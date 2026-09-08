---
"@bunny.net/cli": patch
---

Friendlier handling of small mistakes: "Did you mean" for top-level typos, one-line help pointers (JSON under `--output json`), a clean error for unknown profiles and non-numeric IDs, a login hint naming the credential source on every 401, a warning when `BUNNY_API_KEY` is set instead of `BUNNYNET_API_KEY`, a confirmation on `config profile delete`, and timeouts on the update check. `delete` now also answers to `rm`, a bare `bunny -v` prints the version, and help lists a command's own flags ahead of the global ones.
