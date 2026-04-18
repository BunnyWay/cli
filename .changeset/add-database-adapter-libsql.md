---
"@bunny.net/database-adapter-libsql": minor
---

Add `@bunny.net/database-adapter-libsql` package

Bunny Database adapter for `@bunny.net/database-rest`. Provides `createLibSQLExecutor`
to wrap a `@libsql/client` Client as a `DatabaseExecutor`, and `introspect` to
discover database schema via SQLite PRAGMAs.
