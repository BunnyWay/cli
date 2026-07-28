---
"@bunny.net/cli": minor
"@bunny.net/database-shell": patch
---

feat(db): `bunny db migrations create/list/apply` runs numbered `.sql` files in `migrations/` (or `drizzle/`) once each, tracked in `__bunny_migrations`; `splitStatements` keeps `CREATE TRIGGER` bodies intact; `db shell`, `db studio`, and `db migrations apply` now honour an explicit database ID over `.env` credentials and refuse to send a generated token to a `--url` on a different host
