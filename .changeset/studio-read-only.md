---
"@bunny.net/cli": minor
"@bunny.net/database-studio": minor
"@bunny.net/database-rest": minor
"@bunny.net/database-adapter": patch
"@bunny.net/database-openapi": patch
---

`bunny db studio` is now a read-only explorer: it mints a read-only token and the local server refuses writes. It adds a read-only SQL console with autocomplete and history, a database overview with views and triggers, `CREATE` statements on the Schema tab, and a grid with resizable columns and keyboard cell selection. The UI also gets a searchable table picker (⌘K) for its tabs, tabs that keep their own filters and paging, working NOT LIKE / IS NOT NULL / OR filters, row details that follow foreign keys and show referencing rows, a fuller schema view, and CSV/JSON export of the current page. Tables with 64-bit integers or BLOBs no longer fail to load, and composite primary keys are introspected correctly.
