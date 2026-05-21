# @bunny.net/openapi-client

## 0.0.1

### Patch Changes

- [#63](https://github.com/BunnyWay/cli/pull/63) [`4be3c3d`](https://github.com/BunnyWay/cli/commit/4be3c3d6841a9e4679fb216e8ee083df873c9224) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Internal: rename `@bunny.net/api` workspace package to `@bunny.net/openapi-client` for clarity. No user-facing CLI changes.

- [#65](https://github.com/BunnyWay/cli/pull/65) [`aa2f707`](https://github.com/BunnyWay/cli/commit/aa2f70729b1aba5dc781d762a160c52adbac4628) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Update OpenAPI specs and align CLI with new enum casing.
  - `database` spec bumped to `0.0.130`: adds `size_max_bytes` / `current_size_bytes`, deprecates the string `size_max` / `current_size`.
  - `magic-containers` spec bumped to `v1.9.19.0`: adds `/apps/{appId}/summary` and `/nodes/plain` endpoints, `DeleteApplication` is now async, and several enums (`ApplicationStatus`, `ApplicationRuntimeType`, `AddRegistryStatus`, `RemoveRegistryStatus`, `AnycastIpProtocolVersion`) switched to lowercase / camelCase values.
  - `core` spec: adds External DNS certificate request/complete endpoints and new Stream Video Library / Storage Zone operations; pull-zone and storage-zone list operation IDs renamed (`Index` → `IndexAll`).
  - `bunny apps list` now correctly maps the lowercase `ApplicationStatus` values (`active`, `progressing`, etc.) to display labels; previously a recent API change caused the column to fall through to the raw status string.
