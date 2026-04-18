---
"@bunny.net/database-studio": minor
---

Refactor studio to use `@bunny.net/database-rest` and `@bunny.net/database-adapter-libsql`

Replaces the hand-rolled API handler with the shared REST package. The studio
now introspects the database at startup and delegates all API routes to
`createRestHandler`. The frontend reads table and schema info from the OpenAPI
spec served at the root endpoint.
