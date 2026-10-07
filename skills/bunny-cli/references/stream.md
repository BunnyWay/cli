# Stream Import Commands

> **Experimental.** `bunny stream` is hidden from `--help` while it stabilizes. Flags and JSON shapes may still change.

`bunny stream import` moves an existing video library into a Bunny Stream library from **Vimeo**, **AWS S3** (or an S3-compatible provider), **Wistia**, **Mux**, **Cloudflare Stream**, **JW Player**, or **Brightcove**. Bunny fetches every file straight from the source by URL, so nothing is downloaded to the local machine. The command hands each video to Bunny, tags it, and returns once they are all queued; encoding then happens on Bunny's side.

## Resolving the library

`--library` (alias `--lib`) takes a library name or numeric ID. When omitted, it resolves in this order:

1. `--library`
2. `.bunny/stream.json` (the directory's linked library)
3. Interactive picker, which offers to link the directory (never on `--dry-run`)

The library's own Stream API key is read from the account automatically; nothing extra to configure, and it is never printed.

## Source credentials

Credentials come only from environment variables (or the interactive prompt), never from flags. Set them before running unattended:

| Source       | Variables                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vimeo`      | `VIMEO_ACCESS_TOKEN` (scopes `public`, `private`, `video_files`; downloads need a paid plan)                                                                                     |
| `s3`         | `S3_BUCKET`, `AWS_REGION` (default `us-east-1`); optional `S3_PREFIX`, `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `S3_PRESIGNED_URL_TTL`, `S3_ENDPOINT` |
| `wistia`     | `WISTIA_ACCESS_TOKEN`                                                                                                                                                            |
| `mux`        | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`                                                                                                                                               |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` (Stream:Edit), `CLOUDFLARE_ACCOUNT_ID`                                                                                                                    |
| `jwplayer`   | `JWPLAYER_API_KEY` (v2), `JWPLAYER_SITE_ID`                                                                                                                                      |
| `brightcove` | `BRIGHTCOVE_CLIENT_ID`, `BRIGHTCOVE_CLIENT_SECRET` (CMS video read), `BRIGHTCOVE_ACCOUNT_ID`                                                                                     |

`bunny stream import --help` lists the same variables. With `--source` omitted, the command picks the one source whose variables are all set, otherwise it prompts (or fails when unattended). For S3, leaving both AWS keys unset uses the default AWS credential chain (profile, SSO, instance role); setting only one is an error.

## Typical workflows

```bash
# 1. Look before importing: folders, video counts, what is already in Bunny
bunny stream import --library 12345 --source vimeo --dry-run

# 2. Import (confirms first; --force skips the prompt and is required without a TTY)
bunny stream import --library 12345 --source vimeo --force

# 3. Check how far Bunny has got with encoding
bunny stream import status --library 12345 --source vimeo

# One folder only (Vimeo/Wistia projects, Brightcove folders, S3 prefixes)
bunny stream import --library 12345 --source vimeo --folder 987654 --force

# S3, unattended, overriding the bucket and prefix for this run
bunny stream import --library 12345 --source s3 --bucket my-videos --prefix 2024/ --force

# Continue an interrupted or partly failed run
bunny stream import --library 12345 --source vimeo --resume --force
```

---

## `bunny stream import`: Import a video library

| Flag                                | Description                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `--library`, `--lib`                | Destination library name or ID (defaults to the linked library)                              |
| `--source`, `-s`                    | `vimeo`, `s3`, `wistia`, `mux`, `cloudflare`, `jwplayer`, `brightcove`                       |
| `--folder`                          | One source folder only (not for Mux, Cloudflare Stream, or JW Player, which have no folders) |
| `--dry-run`                         | Print the plan; writes nothing (no state file, no link, nothing in the library)              |
| `--resume`                          | Continue the saved import for this source and library                                        |
| `--wait`                            | Stay until Bunny has encoded every video (default: return once they are queued)              |
| `--force`, `-f`                     | Skip the confirmation (which defaults to No)                                                 |
| `--concurrency`, `-c`               | Videos handed to Bunny in parallel, 1 to 20 (default 3)                                      |
| `--bucket`, `--prefix`, `--url-ttl` | S3 overrides for one run                                                                     |
| `--request-timeout`                 | Seconds per HTTP request (default 30)                                                        |
| `--video-timeout`                   | Seconds per video hand-off, or per encode wait with `--wait` (default 5400)                  |
| `--processing-timeout`              | With `--wait`, seconds per encode (default 3600); raises `--video-timeout` when larger       |

**Re-running is safe.** Every imported video carries a per-source metaTag (`vimeoId`, `s3Source`, `wistiaId`, `muxAssetId`, `cfStreamId`, `jwPlayerId`, `brightcoveId`). A re-run skips tagged videos Bunny has finished, leaves ones still encoding alone, and imports again only the ones Bunny failed on. Source folders become Stream collections of the same name.

**Progress** is saved to `$XDG_STATE_HOME/bunnynet/stream-import/<account>/<source>-<library>.json` (default `~/.local/state/...`). `--resume` retries failed videos, works outstanding ones, and keeps the `--folder` scope the run started with. Two imports cannot share one state file; the second fails while the first is running.

**Ctrl-C** stops queuing new videos, lets a hand-off already sent to Bunny finish so it is recorded, prints the `--resume` command, and exits 130. A second Ctrl-C exits at once.

**Exit codes:** 0 when everything was queued (or finished with `--wait`), 1 when any video failed (they are listed), 130 when paused.

### JSON output

Every `--output json` document carries an `outcome`:

- `no_videos`, `nothing_new`, `dry_run`: stopped before importing. Shape `{ outcome, library, source, folder, dryRun, truncated, summary }`; `summary` holds the counts and name lists (capped at 10000; `truncated` says when).
- `imported`, `paused`: shape `{ outcome, library, source, folder, dryRun, status, waited, queued, completed, processing, failed, collections, warnings, statePath, elapsedMs }`, each `failed` entry `{ name, sourceId, error }`. On `paused`, `library` and `statePath` may be null if it stopped before reaching them.

Declining the confirmation prints nothing.

---

## `bunny stream import status`: Check a queued import

```bash
bunny stream import status --library 12345
bunny stream import status --library 12345 --source s3 --output json
```

Reads the saved run (pass `--source` when more than one platform was imported into the library), asks Bunny for the current state of every video it queued, and prints Bunny's status, encode percentage, size, and when each was queued. A video still processing with no data after 30 minutes is marked `(stalled?)`: delete it in the dashboard and re-run the import. Exits 1 when any video failed, so it works as a poll in scripts. JSON: `{ library, source, status, completed, processing, failed, stalled, stalledAfterMinutes, saved, videos }`.

---

## Anti-patterns

- **Passing credentials as flags or pasting them into commands.** They are read from environment variables only; export them (or use a `.env` the shell loads) instead.
- **Importing without a dry run.** Run `--dry-run` first to see the folder and video counts and what is already in Bunny.
- **Holding the command open with `--wait` in automation.** Queue with `--force`, then poll `bunny stream import status` until it exits 0; encodes can take hours.
- **Deleting the state file to "start fresh".** It is how a resume recovers videos Bunny created but never tagged; deleting it can create duplicates.
- **Treating `(stalled?)` as success.** Bunny gives no signal for a fetch that died silently; the stalled video needs deleting and re-importing.
