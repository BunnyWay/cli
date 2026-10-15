---
"@bunny.net/cli": minor
"@bunny.net/database-studio": minor
"@bunny.net/database-rest": minor
"@bunny.net/database-adapter": patch
"@bunny.net/database-openapi": patch
---

`bunny db studio` is now a read-only explorer: it mints a read-only token and the local server refuses writes. The UI gets a searchable table sidebar, working NOT LIKE / IS NOT NULL / OR filters, row details that follow foreign keys and show referencing rows, a fuller schema view, and CSV/JSON export of the current page. Tables with 64-bit integers or BLOBs no longer fail to load, and composite primary keys are introspected correctly.
