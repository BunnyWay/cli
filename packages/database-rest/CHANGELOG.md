# @bunny.net/database-rest

## 0.1.0

### Minor Changes

- [#43](https://github.com/BunnyWay/cli/pull/43) [`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `@bunny.net/database-rest` package

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

### Patch Changes

- Updated dependencies [[`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642)]:
  - @bunny.net/database-openapi@0.1.0
