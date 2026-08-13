---
"@bunny.net/cli": minor
"@bunny.net/database-shell": patch
---

feat(db): `bunny db migrations create/list/apply` runs numbered `.sql` files in `migrations/` (or `drizzle/`) once each, tracked in `__bunny_migrations`; `--pattern` supports nested ORM layouts while checksum drift and out-of-order files block unsafe applies unless `--allow-drift` is explicit; migration commands show the credential-free database target; `splitStatements` keeps `CREATE TRIGGER` bodies intact, supports every SQLite quote form, drops comments, and rejects truncated SQL; `db shell`, `db studio`, and `db migrations apply` now honour an explicit database ID over `.env` credentials and refuse to send a token to a `--url` on a different host or over an unencrypted connection
