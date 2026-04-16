---
"@bunny.net/database-studio": patch
"@bunny.net/cli": patch
---

embed studio assets in compiled CLI binary

The database studio UI was returning "Not Found" when launched from
the compiled binary because the static files weren't embedded in
the executable. Studio assets are now bundled via Bun's file
embedding at compile time.
