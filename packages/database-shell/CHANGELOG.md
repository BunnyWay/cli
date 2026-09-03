# @bunny.net/database-shell

## 0.2.7

### Patch Changes

- Updated dependencies [[`d6b68a7`](https://github.com/BunnyWay/cli/commit/d6b68a7d0f058d035171f10e0398428f5b6410da)]:
  - @bunny.net/database-client@0.0.3

## 0.2.6

### Patch Changes

- Updated dependencies [[`207ab25`](https://github.com/BunnyWay/cli/commit/207ab25a4e533dfdfd04ecd196a1d83813912604), [`1da83cb`](https://github.com/BunnyWay/cli/commit/1da83cbb2d834dfaf7f6b746f9333fcc2848ba0d), [`dca7b35`](https://github.com/BunnyWay/cli/commit/dca7b3532ff9c4ae319aa59060f9cae3efe5f213), [`63f1037`](https://github.com/BunnyWay/cli/commit/63f103760fd2154cab3da11d5b5480ae6fe32c26)]:
  - @bunny.net/database-client@0.0.2

## 0.2.5

### Patch Changes

- [#183](https://github.com/BunnyWay/cli/pull/183) [`7b6105b`](https://github.com/BunnyWay/cli/commit/7b6105b85fc7e80b29e235ebc5e83dae41170d4e) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix: resolve open code scanning alerts; markdown table cells escape backslashes before pipes so a value containing `\|` no longer splits the cell, the SQL statement splitter counts block depth with a linear scan instead of a regex that rescanned from every offset on a run of unclosed `[`, `sites ci` detects a GitHub origin by remote host instead of a substring match, `database-rest` returns a generic 500 and hands the real error to an `onError` hook (wired to the studio's logger) instead of putting it in the response body, and the CI, template-upload, and install-script-upload workflows pin `GITHUB_TOKEN` to `contents: read`

- [#154](https://github.com/BunnyWay/cli/pull/154) [`294ae07`](https://github.com/BunnyWay/cli/commit/294ae07086ab44ad47e55405a68f6e9397e005a4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `@bunny.net/database-client`, a zero-dependency server-side SQL client for Bunny Database that runs on Edge Scripting, Bun, and Node, and move `db shell`, `db studio`, and `db migrations` onto it in place of `@libsql/client`.

- [#136](https://github.com/BunnyWay/cli/pull/136) [`5e61ab6`](https://github.com/BunnyWay/cli/commit/5e61ab68dac1b14be16748560bdde8b623551c80) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - feat(db): `bunny db migrations create/list/apply` runs numbered `.sql` files in `migrations/` (or `drizzle/`) once each, tracked in `__bunny_migrations`; `--pattern` supports nested ORM layouts while checksum drift and out-of-order files block unsafe applies unless `--allow-drift` is explicit; migration commands show the credential-free database target; `splitStatements` keeps `CREATE TRIGGER` bodies intact, supports every SQLite quote form, drops comments, and rejects truncated SQL; `db shell`, `db studio`, and `db migrations apply` now honour an explicit database ID over `.env` credentials, require encrypted hosted database URLs regardless of token source, and refuse to send an ambient or generated token to a different hostname or service port

- Updated dependencies [[`294ae07`](https://github.com/BunnyWay/cli/commit/294ae07086ab44ad47e55405a68f6e9397e005a4)]:
  - @bunny.net/database-client@0.0.1

## 0.2.4

### Patch Changes

- [#97](https://github.com/BunnyWay/cli/pull/97) [`b122269`](https://github.com/BunnyWay/cli/commit/b122269a5f5523302bccccba383460703818ac75) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix(bsql): fall back to a baseline (non-AVX2) binary on older x64 CPUs that crashed with "Illegal instruction"

## 0.2.3

### Patch Changes

- [#68](https://github.com/BunnyWay/cli/pull/68) [`b74b125`](https://github.com/BunnyWay/cli/commit/b74b12548a6a797f5a1b07b7d55f7528c3f2981b) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Harden URL handling in the embedded database studio with thanks to @jedisct1

## 0.2.2

### Patch Changes

- [#27](https://github.com/BunnyWay/cli/pull/27) [`eed0cc6`](https://github.com/BunnyWay/cli/commit/eed0cc6d1e1a16b84283d39ad7fff29f779cd1b7) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - use custom fetch client for database shell

## 0.2.1

### Patch Changes

- [#18](https://github.com/BunnyWay/cli/pull/18) [`742d018`](https://github.com/BunnyWay/cli/commit/742d0187f82cc7a0dd1acee89f997b1e276c4511) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - use batching for execute file

- [#18](https://github.com/BunnyWay/cli/pull/18) [`742d018`](https://github.com/BunnyWay/cli/commit/742d0187f82cc7a0dd1acee89f997b1e276c4511) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix clear history command

## 0.2.0

### Minor Changes

- [#13](https://github.com/BunnyWay/cli/pull/13) [`a9b8fa9`](https://github.com/BunnyWay/cli/commit/a9b8fa904c621648aa4c416770633ed99e8645c5) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add saved views (queries) to the database shell and CLI

### Patch Changes

- [#15](https://github.com/BunnyWay/cli/pull/15) [`dc4c51a`](https://github.com/BunnyWay/cli/commit/dc4c51af6e968bb5a517fcde2befc32dcf8ba5b2) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix dot-commands failing when arguments include a trailing semicolon (e.g. `.count users;`)

## 0.1.4

### Patch Changes

- [`2230dc1`](https://github.com/BunnyWay/cli/commit/2230dc1a5e4e9d8285e44ba0756cd3f11f3b5714) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix published binaries missing execute permissions and improve error messages for binary execution failures

## 0.1.3

### Patch Changes

- [`d375663`](https://github.com/BunnyWay/cli/commit/d375663b03ddab19a0459e53e97bb9dbb5b65726) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix npm-published binaries not being executable, causing silent failures when running via npx

## 0.1.2

### Patch Changes

- [`4f2f729`](https://github.com/BunnyWay/cli/commit/4f2f72906c07e865019d262614f1be6d0cd81856) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix compiled binary startup crash and optimize builds
  - Switch to @libsql/client/web to eliminate native addon dependency that crashed compiled binaries
  - Lazy-load database imports to prevent startup failures for non-db commands
  - Add --minify and --sourcemap flags for smaller, more debuggable production builds

## 0.1.1

### Patch Changes

- [`b9aaa20`](https://github.com/BunnyWay/cli/commit/b9aaa206c22ebacd628b2a7bb1bb14e77d3449bc) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Switch from @libsql/client to @libsql/client/web to eliminate native addon dependency, fix compiled binary by lazy-loading database imports and inlining version at build time

## 0.1.0

### Minor Changes

- [`39641c1`](https://github.com/BunnyWay/cli/commit/39641c1ef18739cd8201fea766df272ef46b6fc7) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - initial bunny cli
