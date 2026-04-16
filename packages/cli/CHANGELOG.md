# @bunny.net/cli

## 0.2.5

### Patch Changes

- [#16](https://github.com/BunnyWay/cli/pull/16) [`989ddd9`](https://github.com/BunnyWay/cli/commit/989ddd93b36cf158662cdb5a4f28c03032b994b4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Hide `registries` command from help output and landing page (moved to experimental commands)

- [#35](https://github.com/BunnyWay/cli/pull/35) [`55d7928`](https://github.com/BunnyWay/cli/commit/55d7928a035d2624a9ba31049d1570674c3f7553) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Strip API key from browser history after login callback

## 0.2.4

### Patch Changes

- [`0abadc3`](https://github.com/BunnyWay/cli/commit/0abadc3d5027ae717dc918b43866fc5b0543cf01) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix macOS binary killed on launch by pinning Bun to v1.3.11 (v1.3.12 produces unsigned binaries)

## 0.2.3

### Patch Changes

- [`4f4a84d`](https://github.com/BunnyWay/cli/commit/4f4a84dc0b0be1a302a03c2aa238c1259e2835ca) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix macOS binary killed on launch by ad-hoc signing darwin binaries during CI build

## 0.2.2

### Patch Changes

- [#28](https://github.com/BunnyWay/cli/pull/28) [`0e0e2ff`](https://github.com/BunnyWay/cli/commit/0e0e2ff419caf9218f6f5ee0b957b218d93f7f26) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add automatic update check that notifies users when a new CLI version is available

- [#32](https://github.com/BunnyWay/cli/pull/32) [`49dcf66`](https://github.com/BunnyWay/cli/commit/49dcf66ca8bb2740da9ec08abbbfa33bc0018d25) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add raw API command for making authenticated HTTP requests to any bunny.net endpoint

- [#31](https://github.com/BunnyWay/cli/pull/31) [`8343f16`](https://github.com/BunnyWay/cli/commit/8343f1683a9e3626b836979ebe693e76c58cb1ce) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Clean up .env credentials when deleting a database that matches the local environment

- [#30](https://github.com/BunnyWay/cli/pull/30) [`ac9cb05`](https://github.com/BunnyWay/cli/commit/ac9cb0501b423d38459180eea6163fc3ceb4df83) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Prompt to create an auth token and save to .env after interactive database creation

## 0.2.1

### Patch Changes

- [#20](https://github.com/BunnyWay/cli/pull/20) [`4eabd29`](https://github.com/BunnyWay/cli/commit/4eabd291e0259ea76ba81ae5a2fca082c89908f4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix database size formatting of bytes

- [#27](https://github.com/BunnyWay/cli/pull/27) [`eed0cc6`](https://github.com/BunnyWay/cli/commit/eed0cc6d1e1a16b84283d39ad7fff29f779cd1b7) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - use custom fetch client for database shell

- [#25](https://github.com/BunnyWay/cli/pull/25) [`c445698`](https://github.com/BunnyWay/cli/commit/c445698460125968bcccae79a9fe4d2d6159abb6) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - show notice when last region is removed that there are no other replicas

- [#22](https://github.com/BunnyWay/cli/pull/22) [`689830f`](https://github.com/BunnyWay/cli/commit/689830faf454e648b6be89d5196de90b3a1263e4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - ask for confirmation when removing a database region

- [#24](https://github.com/BunnyWay/cli/pull/24) [`0568cf2`](https://github.com/BunnyWay/cli/commit/0568cf226867ed6c844f8aa5359324f0f7787c4e) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - add prompt when creating a database token that previous ones remain valid

- [#23](https://github.com/BunnyWay/cli/pull/23) [`2add08f`](https://github.com/BunnyWay/cli/commit/2add08f3a0d7d69cf744dddfcbcfab1761fa15af) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - add get started and shell instructions on successfull database creation

- [#26](https://github.com/BunnyWay/cli/pull/26) [`340d501`](https://github.com/BunnyWay/cli/commit/340d5012d1b5671a7b187535e5bd805937180718) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - warn when no new tokens created after invalidation

## 0.2.0

### Minor Changes

- [#13](https://github.com/BunnyWay/cli/pull/13) [`a9b8fa9`](https://github.com/BunnyWay/cli/commit/a9b8fa904c621648aa4c416770633ed99e8645c5) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add saved views (queries) to the database shell and CLI

## 0.1.6

### Patch Changes

- [`2230dc1`](https://github.com/BunnyWay/cli/commit/2230dc1a5e4e9d8285e44ba0756cd3f11f3b5714) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix published binaries missing execute permissions and improve error messages for binary execution failures

## 0.1.5

### Patch Changes

- [`d375663`](https://github.com/BunnyWay/cli/commit/d375663b03ddab19a0459e53e97bb9dbb5b65726) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix npm-published binaries not being executable, causing silent failures when running via npx

## 0.1.4

### Patch Changes

- [`4f2f729`](https://github.com/BunnyWay/cli/commit/4f2f72906c07e865019d262614f1be6d0cd81856) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix compiled binary startup crash and optimize builds

  - Switch to @libsql/client/web to eliminate native addon dependency that crashed compiled binaries
  - Lazy-load database imports to prevent startup failures for non-db commands
  - Add --minify and --sourcemap flags for smaller, more debuggable production builds

## 0.1.3

### Patch Changes

- [`b9aaa20`](https://github.com/BunnyWay/cli/commit/b9aaa206c22ebacd628b2a7bb1bb14e77d3449bc) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Switch from @libsql/client to @libsql/client/web to eliminate native addon dependency, fix compiled binary by lazy-loading database imports and inlining version at build time

## 0.1.2

### Patch Changes

- [`b8bb433`](https://github.com/BunnyWay/cli/commit/b8bb433bb396d4c220983915a50555a477335c06) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix npm install by moving build-time dependencies to devDependencies (they are compiled into the binary)

## 0.1.1

### Patch Changes

- [#6](https://github.com/BunnyWay/cli/pull/6) [`b32272f`](https://github.com/BunnyWay/cli/commit/b32272fb8bcf621980832f8a11a59679e266e54a) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - add missing platform arch in version flag

## 0.1.0

### Minor Changes

- [`39641c1`](https://github.com/BunnyWay/cli/commit/39641c1ef18739cd8201fea766df272ef46b6fc7) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - initial bunny cli

### Patch Changes

- Updated dependencies [[`39641c1`](https://github.com/BunnyWay/cli/commit/39641c1ef18739cd8201fea766df272ef46b6fc7)]:
  - @bunny.net/database-shell@0.1.0
