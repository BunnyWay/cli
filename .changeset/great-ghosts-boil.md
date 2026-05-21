---
"@bunny.net/database-openapi": minor
"@bunny.net/database-studio": minor
---

Restore foreign key support in Database Studio. The OpenAPI generator now emits an `x-foreign-key` extension on column schemas, and the studio reads it to show `FK` badges in column headers and let you click a foreign key value to open the referenced row in a side sheet. Also fixes the sticky table header during vertical scroll and a small vertical shift in the Data/Schema toolbar when switching tabs.
