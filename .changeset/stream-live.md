---
"@bunny.net/cli": minor
"@bunny.net/openapi-client": minor
---

feat(stream): add `bunny stream live` for Stream Live: create, list, show, update and delete live streams, get encoder ingest settings and rotate stream keys, preview privately, start and stop, and monitor status, bitrate and live encoding statistics. The live endpoints are typed from a separate preview spec (`@bunny.net/openapi-client/stream-live`) until the public Stream spec includes them. Verbose request and response logs now also redact secret-named query parameters (such as preview tokens) and the query of non-HTTP URLs (such as SRT ingest URLs). API errors now carry the Stream API's own reasons (the `data` list under a generic "Invalid request", and short `text/plain` 4xx bodies) instead of a generic message.
