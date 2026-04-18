---
"@bunny.net/database-rest": minor
---

Add `@bunny.net/database-rest` package

A database-agnostic PostgREST-like REST API handler. Provides query parsing,
SQL building, and a full CRUD request handler with:

- PostgREST-style filtering (`?col=op.value`), sorting, pagination
- Single-resource endpoints by primary key (`/{table}/{pk}`)
- Unique column lookups (`/{table}/by-{column}/{value}`)
- OpenAPI spec served at the root endpoint
- Parameterized SQL with required filters on collection PATCH/DELETE
- URL-encoded table and column name support (spaces, etc.)

Accepts a `DatabaseExecutor` interface instead of a specific database client,
allowing adapters for any database that can run parameterized SQL.
