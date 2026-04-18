---
"@bunny.net/database-openapi": minor
---

Add `@bunny.net/database-openapi` package

Generates an OpenAPI 3.0.3 specification from a `DatabaseSchema` object. Zero
dependencies - pass in a schema, get back a spec with:

- Collection CRUD paths (`/{table}`)
- Single-resource paths by primary key (`/{table}/{pk}`)
- Unique column lookup paths (`/{table}/by-{column}/{value}`)
- Typed schemas (base, insert, update) with name-aware example values
- Error responses, reusable parameters, and top-level tags
- Full index and unique constraint support
