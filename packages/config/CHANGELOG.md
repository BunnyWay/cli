# @bunny.net/config

## 0.1.9

### Patch Changes

- [#298](https://github.com/BunnyWay/cli/pull/298) [`46d13de`](https://github.com/BunnyWay/cli/commit/46d13de93e22684478e13ccf8449827e3fdc7352) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix(apps): accept the image as a positional on `apps init`, and accept region IDs in any case on `--region` and in `bunny.jsonc`

- [#288](https://github.com/BunnyWay/cli/pull/288) [`6124501`](https://github.com/BunnyWay/cli/commit/61245012e85a87711b62f0b7162013eac08d3e1e) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - feat(apps): list `bunny apps` in help as a Public Preview command, deploy from local source, a connected registry, or an image URL, connect GitHub, Docker Hub, or any OCI registry, and fix rollback, paging, multi-container redeploys, and endpoint and volume sync across the apps commands

- [#297](https://github.com/BunnyWay/cli/pull/297) [`d8cb9e5`](https://github.com/BunnyWay/cli/commit/d8cb9e535ff14e2ba0d9494f9909664164775f59) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix(apps): apply health-check probes from `bunny.jsonc`, which were silently dropped, and write them back on `apps pull`

- Updated dependencies [[`6124501`](https://github.com/BunnyWay/cli/commit/61245012e85a87711b62f0b7162013eac08d3e1e), [`b60fab8`](https://github.com/BunnyWay/cli/commit/b60fab8b5ca0cc6d0fe8948c73e78f3ca0167a6b)]:
  - @bunny.net/openapi-client@0.3.2

## 0.1.8

### Patch Changes

- Updated dependencies [[`7814b1f`](https://github.com/BunnyWay/cli/commit/7814b1f6ade634182245acf3146588f59c97f698)]:
  - @bunny.net/openapi-client@0.3.1

## 0.1.7

### Patch Changes

- [#214](https://github.com/BunnyWay/cli/pull/214) [`df79bb9`](https://github.com/BunnyWay/cli/commit/df79bb968187fc3d0b5e3ae201b7c00ee6ae8dc9) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - `bunny sites deploy` serves single-page apps on refresh (`sites.spa`, detected from the framework) and uses a root `404.html` as the not-found page.

## 0.1.6

### Patch Changes

- [#198](https://github.com/BunnyWay/cli/pull/198) [`2c98438`](https://github.com/BunnyWay/cli/commit/2c984387baa082d13dbf6d2a67a19cc594756ecb) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Keep existing container env vars on `apps deploy` and `apps push` when bunny.jsonc has no env block

## 0.1.5

### Patch Changes

- Updated dependencies [[`cdb130a`](https://github.com/BunnyWay/cli/commit/cdb130ad869c96eee4bee8eef610e360f51b4958), [`3dff411`](https://github.com/BunnyWay/cli/commit/3dff411468a9bf3602dfd66f0bdc0a9f2cbf851e)]:
  - @bunny.net/openapi-client@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`8b8adb4`](https://github.com/BunnyWay/cli/commit/8b8adb486046513c5921daa06ee6befe9c221334)]:
  - @bunny.net/openapi-client@0.2.0

## 0.1.3

### Patch Changes

- [#125](https://github.com/BunnyWay/cli/pull/125) [`9696434`](https://github.com/BunnyWay/cli/commit/96964348d630df5b8344087deac50bb6da4a5734) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - rename `@bunny.net/app-config` to `@bunny.net/config` and add a top-level `sites` block (`name`, `dir`, `build`) to the bunny.jsonc schema; the root `BunnyConfigSchema` makes `app` and `sites` optional so app-only, sites-only, and combined files all validate against the generated JSON Schema

## 0.1.2

### Patch Changes

- Updated dependencies [[`18645ed`](https://github.com/BunnyWay/cli/commit/18645edc7736eb5d88f1a8ec038993cc7d2deb12)]:
  - @bunny.net/openapi-client@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`73cb7a7`](https://github.com/BunnyWay/cli/commit/73cb7a74741898144dbc80e4b8554f102d7c8f03)]:
  - @bunny.net/openapi-client@0.1.1

## 0.1.0

### Minor Changes

- [#66](https://github.com/BunnyWay/cli/pull/66) [`adc1ef8`](https://github.com/BunnyWay/cli/commit/adc1ef8e3d3803b6cec04a2ca649747adf23980f) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Rework bunny apps deploy command

### Patch Changes

- Updated dependencies [[`ca6cc9b`](https://github.com/BunnyWay/cli/commit/ca6cc9bce501002c03d4348f7dc38c60cea0b7f5)]:
  - @bunny.net/openapi-client@0.1.0

## 0.0.1

### Patch Changes

- Updated dependencies [[`4be3c3d`](https://github.com/BunnyWay/cli/commit/4be3c3d6841a9e4679fb216e8ee083df873c9224), [`aa2f707`](https://github.com/BunnyWay/cli/commit/aa2f70729b1aba5dc781d762a160c52adbac4628)]:
  - @bunny.net/openapi-client@0.0.1
