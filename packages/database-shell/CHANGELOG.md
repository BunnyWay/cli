# @bunny.net/database-shell

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
