---
"@bunny.net/cli": minor
"@bunny.net/openapi-client": patch
"@bunny.net/stream-import": minor
"@bunny.net/stream-import-vimeo": minor
"@bunny.net/stream-import-s3": minor
"@bunny.net/stream-import-wistia": minor
"@bunny.net/stream-import-mux": minor
"@bunny.net/stream-import-cloudflare": minor
"@bunny.net/stream-import-jwplayer": minor
"@bunny.net/stream-import-brightcove": minor
---

`bunny stream import` moves a video library into Bunny Stream from Vimeo, AWS S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove: it hands every video to Bunny and returns, `--wait` stays for encoding, and `bunny stream import status` shows Bunny's progress; with a dry run, resumable state, and de-duplication. The engine ships as `@bunny.net/stream-import` and each source adapter as `@bunny.net/stream-import-<source>`; `@bunny.net/openapi-client` verbose logs now redact the Authorization header and URL query strings, skip binary bodies, and surface Stream error messages.
