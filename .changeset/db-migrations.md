---
"@bunny.net/cli": minor
"@bunny.net/database-shell": patch
---

feat(db): `bunny db migrations create/list/apply` runs numbered `.sql` files in `migrations/` (or `drizzle/`) once each, tracked in `__bunny_migrations`; `splitStatements` now keeps `CREATE TRIGGER` bodies intact
