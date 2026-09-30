---
"@bunny.net/cli": patch
---

`bunny sites deploy` hashes content the same way on every machine and in the dashboard, whatever the locale. A site's next content deploy after upgrading gets a new content hash once, so unchanged files are published again rather than skipped.
