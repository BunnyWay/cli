# @bunny.net/database-adapter-libsql

## 0.1.0

### Minor Changes

- [#43](https://github.com/BunnyWay/cli/pull/43) [`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `@bunny.net/database-adapter-libsql` package

  Bunny Database adapter for `@bunny.net/database-rest`. Provides:

  - `createLibSQLExecutor` to wrap a `@libsql/client` Client as a `DatabaseExecutor`
  - `introspect` to discover database schema via SQLite PRAGMAs (tables, columns,
    primary keys, foreign keys, indexes, unique constraints)
  - Configurable table filtering with `exclude`/`include` patterns
  - Sensible defaults that hide common migration/framework tables (`__*`,
    `_prisma_migrations`, `schema_migrations`, etc.)

### Patch Changes

- Updated dependencies [[`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642), [`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642)]:
  - @bunny.net/database-openapi@0.1.0
  - @bunny.net/database-rest@0.1.0
