---
"@bunny.net/database-studio": patch
"@bunny.net/cli": patch
---

fix `db studio` for table and column names containing spaces

The studio API rejected any identifier that didn't match
`[a-zA-Z_][a-zA-Z0-9_]*`, returning a 400 "Invalid table name" for
tables or columns with spaces. Replaced the validation with safe
double-quote identifier escaping so any SQLite-valid name works.
