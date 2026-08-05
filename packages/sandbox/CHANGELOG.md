# @bunny.net/sandbox

## 0.3.3

### Patch Changes

- Updated dependencies [[`8b8adb4`](https://github.com/BunnyWay/cli/commit/8b8adb486046513c5921daa06ee6befe9c221334)]:
  - @bunny.net/openapi-client@0.2.0

## 0.3.2

### Patch Changes

- [#128](https://github.com/BunnyWay/cli/pull/128) [`f6b64a3`](https://github.com/BunnyWay/cli/commit/f6b64a3a414aefe059fbcf1ec6b0003b0dd1d04d) Thanks [@amir-at-bunny](https://github.com/amir-at-bunny)! - Sandbox is now visible on the CLI root help and landing page, with create examples in the README and root help. The backing Magic Containers app is now named `sandbox-<name>` so sandboxes are recognizable in the MC dashboard; default generated sandbox names dropped their `sandbox-` prefix accordingly.

## 0.3.1

### Patch Changes

- [`ad79781`](https://github.com/BunnyWay/cli/commit/ad797813d850fd39df048f8e1cfa3c0cc3598fcd) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix(sandbox): Sandbox.get() recovers exposed port mappings from CDN endpoints so domain() works after reconnect

- [#124](https://github.com/BunnyWay/cli/pull/124) [`9e31add`](https://github.com/BunnyWay/cli/commit/9e31add7c64acdf9b31b60ac149598e80715e670) Thanks [@jedisct1](https://github.com/jedisct1)! - fix(sandbox): verify a sandbox's SSH host key before sending a token, pinning it in a known-hosts store to prevent credential disclosure to an impersonating server

- [#122](https://github.com/BunnyWay/cli/pull/122) [`27a1929`](https://github.com/BunnyWay/cli/commit/27a1929c0e3b8973c2c11cf4e19dba9f3360c43a) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - feat(sandbox): stream blocking command output via `onStdout`/`onStderr` callbacks (composes with `timeout`/`signal`), and support `using`/`await using` (Symbol.dispose/asyncDispose) to release the SSH connection when a sandbox leaves scope.

- [#122](https://github.com/BunnyWay/cli/pull/122) [`27a1929`](https://github.com/BunnyWay/cli/commit/27a1929c0e3b8973c2c11cf4e19dba9f3360c43a) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - feat(sandbox): runCommand timeout and AbortSignal cancellation, plus listFiles, deleteFile, rename, and exists file operations

## 0.3.0

### Minor Changes

- [#111](https://github.com/BunnyWay/cli/pull/111) [`87e2c3d`](https://github.com/BunnyWay/cli/commit/87e2c3d7f8021bece3a27fe371fa5d710a7cdb8e) Thanks [@amir-at-bunny](https://github.com/amir-at-bunny)! - feat(sandbox): add environment variable support
  - SDK: `Sandbox` gains `getEnv`/`setEnv`/`unsetEnv` to read and persist container env vars after creation (merges with the existing set, preserves reserved keys).
  - CLI: `sandbox create`, `sandbox exec`, and `sandbox ssh` accept `-e/--env KEY=VALUE` (repeatable) and `--env-file`. Vars on `create` are persisted; on `exec`/`ssh` they are temporary for that invocation.
  - CLI: new `sandbox env` namespace (`set`/`list`/`delete`) to manage persisted env vars.

## 0.2.1

### Patch Changes

- [#109](https://github.com/BunnyWay/cli/pull/109) [`e7ba811`](https://github.com/BunnyWay/cli/commit/e7ba811f71689df97220b748f3ccaf7a8e6486f2) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Publish @bunny.net/sandbox to npm

## 0.2.0

### Minor Changes

- [#99](https://github.com/BunnyWay/cli/pull/99) [`6c05e7f`](https://github.com/BunnyWay/cli/commit/6c05e7f046c869dc71484a20231e7855b19d33f6) Thanks [@amir-at-bunny](https://github.com/amir-at-bunny)! - Add @bunny.net/sandbox SDK for programmatic sandbox create, file buffering, command execution, and port exposure; wire sandbox CLI commands onto it

### Patch Changes

- Updated dependencies [[`18645ed`](https://github.com/BunnyWay/cli/commit/18645edc7736eb5d88f1a8ec038993cc7d2deb12)]:
  - @bunny.net/openapi-client@0.1.2
