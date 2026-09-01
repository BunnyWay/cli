# @bunny.net/database-adapter

## 0.1.4

### Patch Changes

- Updated dependencies [[`207ab25`](https://github.com/BunnyWay/cli/commit/207ab25a4e533dfdfd04ecd196a1d83813912604), [`1da83cb`](https://github.com/BunnyWay/cli/commit/1da83cbb2d834dfaf7f6b746f9333fcc2848ba0d), [`dca7b35`](https://github.com/BunnyWay/cli/commit/dca7b3532ff9c4ae319aa59060f9cae3efe5f213), [`63f1037`](https://github.com/BunnyWay/cli/commit/63f103760fd2154cab3da11d5b5480ae6fe32c26)]:
  - @bunny.net/database-client@0.0.2
  - @bunny.net/database-rest@0.1.2

## 0.1.3

### Patch Changes

- Updated dependencies [[`294ae07`](https://github.com/BunnyWay/cli/commit/294ae07086ab44ad47e55405a68f6e9397e005a4)]:
  - @bunny.net/database-client@0.0.1
  - @bunny.net/database-rest@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [[`91dd4b0`](https://github.com/BunnyWay/cli/commit/91dd4b0aa51c766c27c90247f6840deefc0f09fb), [`91dd4b0`](https://github.com/BunnyWay/cli/commit/91dd4b0aa51c766c27c90247f6840deefc0f09fb)]:
  - @bunny.net/database-openapi@0.2.0
  - @bunny.net/database-rest@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`b74b125`](https://github.com/BunnyWay/cli/commit/b74b12548a6a797f5a1b07b7d55f7528c3f2981b)]:
  - @bunny.net/database-rest@0.1.1

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
