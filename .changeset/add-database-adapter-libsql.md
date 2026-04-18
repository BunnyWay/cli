---
"@bunny.net/database-adapter-libsql": minor
---

Add `@bunny.net/database-adapter-libsql` package

Bunny Database adapter for `@bunny.net/database-rest`. Provides:

- `createLibSQLExecutor` to wrap a `@libsql/client` Client as a `DatabaseExecutor`
- `introspect` to discover database schema via SQLite PRAGMAs (tables, columns,
  primary keys, foreign keys, indexes, unique constraints)
- Configurable table filtering with `exclude`/`include` patterns
- Sensible defaults that hide common migration/framework tables (`__*`,
  `_prisma_migrations`, `schema_migrations`, etc.)
