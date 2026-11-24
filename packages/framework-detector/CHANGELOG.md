# @bunny.net/framework-detector

## 0.2.0

### Minor Changes

- [#313](https://github.com/BunnyWay/cli/pull/313) [`65aaa7a`](https://github.com/BunnyWay/cli/commit/65aaa7a0036c8b7bdb525c335390a252499da2e9) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - feat(sites): `sites deploy` prunes to the live and previous deploys by default (existing sites opt in once), with `sites.keep` in bunny.jsonc and `deploy --keep`; `sites deployments prune` without `--keep` now follows the same setting and keeps only the live and previous deploys instead of the newest 5

## 0.1.0

### Minor Changes

- [#241](https://github.com/BunnyWay/cli/pull/241) [`9a743f5`](https://github.com/BunnyWay/cli/commit/9a743f54b3ac0beef06dd129680870f13cdf5595) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Publish `@bunny.net/framework-detector`: the framework presets, framework and package manager detection, and the GitHub Actions workflow behind `bunny sites`, as a dependency-free package the dashboard and the Sites control plane share with the CLI. `bunny sites deploy` now hashes content the same way on every machine and in the dashboard, whatever the locale; a site's next content deploy after upgrading gets a new content hash once, so an unchanged folder is published again rather than skipped.
