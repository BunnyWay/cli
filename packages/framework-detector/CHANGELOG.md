# @bunny.net/framework-detector

## 0.1.0

### Minor Changes

- [#241](https://github.com/BunnyWay/cli/pull/241) [`9a743f5`](https://github.com/BunnyWay/cli/commit/9a743f54b3ac0beef06dd129680870f13cdf5595) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Publish `@bunny.net/framework-detector`: the framework presets, framework and package manager detection, and the GitHub Actions workflow behind `bunny sites`, as a dependency-free package the dashboard and the Sites control plane share with the CLI. `bunny sites deploy` now hashes content the same way on every machine and in the dashboard, whatever the locale; a site's next content deploy after upgrading gets a new content hash once, so an unchanged folder is published again rather than skipped.
