---
"@bunny.net/database-rest": minor
---

Add `@bunny.net/database-rest` package

A database-agnostic PostgREST-like REST API handler. Provides query parsing,
SQL building, and a full CRUD request handler with PostgREST-style filtering
(`?col=op.value`), sorting, pagination, single-resource endpoints (`/{table}/{pk}`),
and an OpenAPI spec at the root endpoint. Uses parameterized SQL and requires
filters on collection PATCH/DELETE to prevent accidental mass operations.

Accepts a `DatabaseExecutor` interface instead of a specific database client,
allowing adapters for any database that can run parameterized SQL.
