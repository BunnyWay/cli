# @bunny.net/database-shell

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
