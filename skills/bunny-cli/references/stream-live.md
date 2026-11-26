# Stream Live Commands

`bunny stream live` creates and runs live streams in a Stream video library. It is a **closed preview**: it works on video libraries created during the preview, and features, limits and pricing may change. Docs: https://bunny.net/docs/stream/live

Every command takes `--lib` (alias `--library`, name or ID; defaults to the linked library) and the live stream ID as an optional positional. Without an ID a terminal shows a picker; unattended runs (`--output json`, no TTY, `--force`) need the ID.

## Lifecycle

```bash
bunny stream live create "Launch keynote" --lib 12345 --output json   # note the id
bunny stream live ingest <id> --show-secret          # server URLs + stream key for the encoder
# ...encoder connects: status Preview (private, nothing recorded)...
bunny stream live status <id>                        # primaryLive / readyToStart / bitrate
bunny stream live start <id> --force                 # public; recording starts if --record
bunny stream live stop <id> --force                  # ends for good; recording becomes a video
```

Statuses: `created`, `scheduled`, `preview` (encoder connected, not public), `running` (live), `ended`, `vodProcessing`, `error`.

- A stream with `--start` goes live by itself at that time, no `start` needed; `start` before then takes it live early. Start while the encoder publishes: nothing before the start is recorded. Without an encoder it asks first; `--force` starts anyway.
- `stop` only works on a running stream and can't be undone. To drop one that never went live, `delete` it.
- `--auto-start` makes connecting the encoder take the stream live, skipping preview.
- Playback is ready 15-20 seconds after the encoder connects and after the start.

## Create and update

```bash
bunny stream live create "Keynote" --record --dvr 1h --start +30m --end +3h --countdown
bunny stream live create "24/7 radio" --type channel --auto-start
bunny stream live create "Simulcast" --rtmp-output rtmps://a.rtmp.youtube.com/live2/<key>
bunny stream live update <id> --title "Keynote (day 2)" --end +1h
bunny stream live update <id> --start none --rtmp-output none     # "none" removes a value
```

- `--type event` (default): at most 12 hours, ends 30 minutes after the encoder disconnects, can be recorded. `--type channel`: 24/7, survives disconnects, never recorded; `--type channel --record` is refused.
- `--dvr` takes `30m`, `2h` (max `12h`); `0` turns DVR off. `--start`/`--end` take ISO 8601 UTC or `+30m`. Scheduled streams show a countdown when the library's setting has it on; `--countdown`/`--no-countdown` override it.
- `--rtmp-output` (RTMP outputs, as the dashboard calls them) is the destination's full RTMP(S) URL ending in its stream key; up to 4. On `update` it replaces the list.
- While live, only `--title`, `--description` and `--end` can change. `--type` changes only before the start, with no encoder connected.
- Settings left out on `create` use the library's live defaults.

## Encoder settings and keys

```bash
bunny stream live ingest <id>                        # key masked, also inside SRT URLs
bunny stream live ingest <id> --show-secret --output json
bunny stream live ingest --auto-create --show-secret # video library stream key: publishing creates + starts a stream
bunny stream live rotate-key <id> --force            # connected encoders are disconnected
```

- RTMP/RTMPS: the encoder takes the server URL and the stream key separately. SRT: the URL already carries the key.
- Encoder: H.264 8-bit 4:2:0, stereo AAC 48 kHz, constant bitrate, 2 s keyframes; 1080p at 5,000-8,000 kbps (up to 60 fps), 4K at 8,000-25,000 kbps (up to 30 fps). No HEVC/AV1/10-bit/HDR ingest.
- `show`, `list` and `--output json` of those never include the stream key.

## Monitoring

```bash
bunny stream live status <id> --watch                # refresh until Ctrl-C (not with --output json)
bunny stream live preview <id>                       # option 1: token-protected player URL from the API (10 h)
bunny stream live preview <id> --sign --expires 2h   # option 2: sign the token with the stream key (max 10h5m)
bunny stream live bitrate <id> --since 15m
bunny stream live show <id>                          # includes issues: failovers, refused publishes, abnormal stops
bunny stream live stats --from 2026-11-01            # encoding minutes, primary vs backup
```

Preview links are token-protected and only work while the stream is Created, Scheduled or in Preview; they stop when it goes public. Option 1 (default) includes the view token when the library needs one and a CDN-signed playlist. Option 2 (`--sign`, HMAC-SHA256 with the stream key) adds neither, and rotating the key invalidates it. An expired or forged token is ignored, not rejected: the viewer sees the public view.

## Anti-patterns

- Don't `start` before the encoder publishes and expect a full recording: only what comes after the start is recorded.
- Don't `stop` to tidy up a stream that never went live: `stop` refuses it; use `delete`.
- Don't print stream keys into logs or CI output without need: `--show-secret` is the only way they appear.
- Don't use a pre-preview video library: live works only on libraries created during the preview.
- Concurrency during the preview is 3 live streams per account; `create` fails with a clear error past that.
