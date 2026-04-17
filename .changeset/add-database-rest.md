---
"@bunny.net/database-rest": minor
---

Add `@bunny.net/database-rest` package

A PostgREST-like REST API for libSQL databases. Provides database introspection,
a full CRUD request handler with PostgREST-style filtering (`?col=op.value`),
sorting, pagination, and serves the OpenAPI spec at the root endpoint. Uses
parameterized SQL and requires filters on PATCH/DELETE to prevent accidental
mass operations.
