---
"@bunny.net/database-client": patch
"@bunny.net/cli": patch
---

Harden `@bunny.net/database-client`: results carry `rowsRead` and `rowsWritten`, `batch()` takes a `mode`, guards its ROLLBACK, rejects transaction statements, and reports the failing statement as `error.batchIndex`; invalid `timeout` values and malformed responses become `DatabaseError`, transport errors keep their `cause`, integer-valued doubles past 2^53 bind as REAL, and `db.sql` carries a row type. Migrations apply with `BEGIN IMMEDIATE`.
