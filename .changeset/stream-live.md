---
"@bunny.net/cli": minor
"@bunny.net/openapi-client": minor
---

feat(stream): add `bunny stream live` for Stream Live (closed preview): create, list, show, update and delete live streams, get encoder ingest settings and rotate stream keys, preview privately, start and stop, and monitor status, bitrate and live encoding statistics. `stream libraries create` and the new-library path of `stream import` now ask for library features (premium encoding plan and codecs, transcribing languages and smart generate) after the replication regions, with `--encoding-plan` and `--no-features` as flag equivalents. The Stream spec is refreshed to the current public version, and the live endpoints are typed from a separate preview spec (`@bunny.net/openapi-client/stream-live`) until the public spec includes them. Also adds VAST ads (`libraries player update --vast-url`), the library webhook URL (`libraries update --webhook-url`), `libraries watermark`, `libraries geo-blocking` (with the supported country list and the dashboard's presets), `libraries usage` for billable usage with cost estimates, and `videos storage` for a video's storage breakdown.
