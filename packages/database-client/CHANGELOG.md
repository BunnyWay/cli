# @bunny.net/database-client

## 0.0.3

### Patch Changes

- [#206](https://github.com/BunnyWay/cli/pull/206) [`d6b68a7`](https://github.com/BunnyWay/cli/commit/d6b68a7d0f058d035171f10e0398428f5b6410da) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Harden `@bunny.net/database-client`: `batch()` takes a `mode`, guards its ROLLBACK, rejects transaction statements, and reports the failing statement as `error.batchIndex`; invalid `timeout` values and malformed responses become `DatabaseError`, transport errors keep their `cause`, integer-valued doubles past 2^53 bind as REAL, and `db.sql` carries a row type. Migrations apply with `BEGIN IMMEDIATE`.

## 0.0.2

### Patch Changes

- [#187](https://github.com/BunnyWay/cli/pull/187) [`207ab25`](https://github.com/BunnyWay/cli/commit/207ab25a4e533dfdfd04ecd196a1d83813912604) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add npm metadata: description, license, repository, keywords, and engines

- [#186](https://github.com/BunnyWay/cli/pull/186) [`1da83cb`](https://github.com/BunnyWay/cli/commit/1da83cbb2d834dfaf7f6b746f9333fcc2848ba0d) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Use `npm:` specifiers for the Edge Scripting SDK in the README

- [#193](https://github.com/BunnyWay/cli/pull/193) [`dca7b35`](https://github.com/BunnyWay/cli/commit/dca7b3532ff9c4ae319aa59060f9cae3efe5f213) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Let `prepare<T>()` type every row the statement returns, including through `batch()`

- [#191](https://github.com/BunnyWay/cli/pull/191) [`63f1037`](https://github.com/BunnyWay/cli/commit/63f103760fd2154cab3da11d5b5480ae6fe32c26) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `db.sql` for building statements from template literals

## 0.0.1

### Patch Changes

- [#154](https://github.com/BunnyWay/cli/pull/154) [`294ae07`](https://github.com/BunnyWay/cli/commit/294ae07086ab44ad47e55405a68f6e9397e005a4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `@bunny.net/database-client`, a zero-dependency server-side SQL client for Bunny Database that runs on Edge Scripting, Bun, and Node, and move `db shell`, `db studio`, and `db migrations` onto it in place of `@libsql/client`.
