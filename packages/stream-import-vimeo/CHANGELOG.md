# @bunny.net/stream-import-vimeo

## 0.2.0

### Minor Changes

- [#316](https://github.com/BunnyWay/cli/pull/316) [`be1f590`](https://github.com/BunnyWay/cli/commit/be1f590051fc7d81a27f404857fdf4d45617d0c3) Thanks [@NathanZBunny](https://github.com/NathanZBunny)! - fix(stream import): pace large Vimeo imports and slow down after failed fetches. An import of more than 500 Vimeo videos now runs with `--concurrency 2 --delay 10 --request-timeout 120` unless those flags are passed, and says so with an estimate of the hand-off time. A fetch Bunny fails with HTTP 422 or 503 now reads "Import failed, try slowing down the import using delay or concurrency", the run widens the gap between videos by itself once that happens, and the summary and retry offer resume more slowly. Adds `--delay`, the engine's `fetchIntervalMs` option, `SourceRejectedError`, and a `largeLibrary` profile on source plugins.

### Patch Changes

- [#318](https://github.com/BunnyWay/cli/pull/318) [`b0ba261`](https://github.com/BunnyWay/cli/commit/b0ba261f4c1ce570e984c16c258a9ce54104782d) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Require zod 4.6.6 or later to pick up the fix for GHSA-mrhx-c7xc-m3w5

- Updated dependencies [[`b0ba261`](https://github.com/BunnyWay/cli/commit/b0ba261f4c1ce570e984c16c258a9ce54104782d), [`be1f590`](https://github.com/BunnyWay/cli/commit/be1f590051fc7d81a27f404857fdf4d45617d0c3)]:
  - @bunny.net/stream-import@0.2.0

## 0.1.0

### Minor Changes

- [#203](https://github.com/BunnyWay/cli/pull/203) [`7814b1f`](https://github.com/BunnyWay/cli/commit/7814b1f6ade634182245acf3146588f59c97f698) Thanks [@amir-at-bunny](https://github.com/amir-at-bunny)! - `bunny stream import` moves a video library into Bunny Stream from Vimeo, AWS S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove: it hands every video to Bunny and returns, `--wait` stays for encoding, `bunny stream import status` shows Bunny's progress, and `bunny stream import list` browses the source; with a dry run, resumable state, and de-duplication. The engine ships as `@bunny.net/stream-import` and each source adapter as `@bunny.net/stream-import-<source>`; `@bunny.net/openapi-client` verbose logs now redact the Authorization header and URL query strings, skip binary bodies, and surface Stream error messages.

### Patch Changes

- Updated dependencies [[`7814b1f`](https://github.com/BunnyWay/cli/commit/7814b1f6ade634182245acf3146588f59c97f698)]:
  - @bunny.net/stream-import@0.1.0
