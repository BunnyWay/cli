---
"@bunny.net/cli": patch
"@bunny.net/database-client": patch
"@bunny.net/database-shell": patch
---

Add `@bunny.net/database-client`, a zero-dependency server-side SQL client for Bunny Database that runs on Edge Scripting, Bun, and Node, and move `db shell`, `db studio`, and `db migrations` onto it in place of `@libsql/client`.
