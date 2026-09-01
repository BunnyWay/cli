# @bunny.net/config

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
