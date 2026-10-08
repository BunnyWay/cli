# @bunny.net/stream-import-wistia

## 0.1.0

### Minor Changes

- [#203](https://github.com/BunnyWay/cli/pull/203) [`7814b1f`](https://github.com/BunnyWay/cli/commit/7814b1f6ade634182245acf3146588f59c97f698) Thanks [@amir-at-bunny](https://github.com/amir-at-bunny)! - `bunny stream import` moves a video library into Bunny Stream from Vimeo, AWS S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove: it hands every video to Bunny and returns, `--wait` stays for encoding, `bunny stream import status` shows Bunny's progress, and `bunny stream import list` browses the source; with a dry run, resumable state, and de-duplication. The engine ships as `@bunny.net/stream-import` and each source adapter as `@bunny.net/stream-import-<source>`; `@bunny.net/openapi-client` verbose logs now redact the Authorization header and URL query strings, skip binary bodies, and surface Stream error messages.

### Patch Changes

- Updated dependencies [[`7814b1f`](https://github.com/BunnyWay/cli/commit/7814b1f6ade634182245acf3146588f59c97f698)]:
  - @bunny.net/stream-import@0.1.0
