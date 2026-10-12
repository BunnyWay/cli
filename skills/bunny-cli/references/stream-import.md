# Stream Import Commands

> **Experimental.** `bunny stream` is hidden from `--help` while it stabilizes. Flags and JSON shapes may still change.

`bunny stream import` moves an existing video library into a Bunny Stream library from **Vimeo**, **AWS S3** (or an S3-compatible provider), **Wistia**, **Mux**, **Cloudflare Stream**, **JW Player**, or **Brightcove**. Bunny fetches every file straight from the source by URL, so nothing is downloaded to the local machine. The command hands each video to Bunny, tags it, and returns once they are all queued; encoding then happens on Bunny's side.

## Resolving the library

`--library` (alias `--lib`) takes a library name or numeric ID. When omitted, it resolves in this order:

1. `--library`
2. `.bunny/stream.json` (the directory's linked library, see `stream.md`)
3. Interactive picker, which offers to link the directory (never on `--dry-run`)

The library's own Stream API key is read from the account automatically and never printed.

## Source credentials

Credentials come from environment variables, never from flags:

| Source       | Variables                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vimeo`      | `VIMEO_ACCESS_TOKEN` (scopes `public`, `private`, `video_files`; downloads need a Standard plan or above)                                                                                                                            |
| `s3`         | `S3_BUCKET`, `AWS_REGION` (or `AWS_DEFAULT_REGION`; default `us-east-1`); optional `S3_PREFIX`, `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `S3_PRESIGNED_URL_TTL`, `S3_ENDPOINT` (or `AWS_ENDPOINT_URL_S3`) |
| `wistia`     | `WISTIA_ACCESS_TOKEN`                                                                                                                                                                                                                |
| `mux`        | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`                                                                                                                                                                                                   |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` (Stream:Edit), `CLOUDFLARE_ACCOUNT_ID`                                                                                                                                                                        |
| `jwplayer`   | `JWPLAYER_API_KEY` (v2), `JWPLAYER_SITE_ID`                                                                                                                                                                                          |
| `brightcove` | `BRIGHTCOVE_CLIENT_ID`, `BRIGHTCOVE_CLIENT_SECRET` (CMS video read), `BRIGHTCOVE_ACCOUNT_ID`                                                                                                                                         |

`bunny stream import --help` lists the same variables. Interactively, the command prompts only for missing required values, then offers to save them for the active profile in `$XDG_CONFIG_HOME/bunnynet/stream-import-credentials.json` (default `~/.config/...`). Environment variables always win over saved values, and saved values are removed only when the source rejects them. Unattended runs (`--output json`, no TTY) fail naming the missing variables.

With `--source` omitted, the command picks the one source whose credentials are all set, otherwise it prompts (or fails when unattended).

S3 notes: leaving both AWS keys unset uses the default AWS credential chain; setting only one is an error. The IAM policy needs `s3:ListBucket` and `s3:GetObject`. Only video extensions are imported; `.ts` files only with `--include-ts` (or `S3_INCLUDE_TS=true`), since HLS buckets hold thousands of segments.

## Typical workflows

```bash
# 1. Browse the source: folders and their IDs, or every video
bunny stream import list --source vimeo
bunny stream import list --source vimeo --videos

# 2. Look before importing: folder and video counts, what is already in Bunny
bunny stream import --library 12345 --source vimeo --dry-run

# 3. Import (confirms first; --force skips the prompt and is required without a TTY)
bunny stream import --library 12345 --source vimeo --force

# 4. Check how far Bunny has got with encoding
bunny stream import status --library 12345 --source vimeo

# One folder only (Vimeo/Wistia projects, Brightcove folders, S3 prefixes)
bunny stream import --library 12345 --source vimeo --folder 987654 --force

# S3, unattended, overriding the bucket and prefix for this run
bunny stream import --library 12345 --source s3 --bucket my-videos --prefix 2024/ --force

# Continue an interrupted or partly failed run
bunny stream import --library 12345 --source vimeo --resume --force

# Re-fetch videos stuck at zero bytes, or retry ones Bunny rejected
bunny stream import --library 12345 --source vimeo --retry-stalled --force
bunny stream import --library 12345 --source vimeo --clean-failed --force
```

---

## `bunny stream import`: Import a video library

| Flag                                | Description                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--library`, `--lib`                | Destination library name or ID (defaults to the linked library)                                                      |
| `--source`, `-s`                    | `vimeo`, `s3`, `wistia`, `mux`, `cloudflare`, `jwplayer`, `brightcove`                                               |
| `--folder`                          | One source folder only (Vimeo, S3, Wistia, Brightcove; rejected for Mux, Cloudflare Stream, JW Player)               |
| `--dry-run`                         | Print the plan; writes nothing (no state file, no link, nothing in the library)                                      |
| `--resume`                          | Continue the saved import for this source and library                                                                |
| `--wait`                            | Stay until Bunny has encoded every video (default: return once they are queued)                                      |
| `--force`, `-f`                     | Skip the confirmation (which defaults to No) and the post-run retry offer                                            |
| `--concurrency`, `-c`               | Videos handed to Bunny in parallel, 1 to 20 (default 3)                                                              |
| `--bucket`, `--prefix`, `--url-ttl` | S3 overrides for one run (`--url-ttl` 3600 to 604800 seconds)                                                        |
| `--include-ts`                      | S3: import `.ts` files too                                                                                           |
| `--clean-failed`                    | Delete a video's failed Bunny copies before importing it again; retries rejected videos and ones that failed 3 times |
| `--retry-stalled`                   | Delete and import again videos stuck at zero bytes past the 30 minute stall threshold                                |
| `--request-timeout`                 | Seconds per HTTP request, 1 to 3600 (default 30)                                                                     |
| `--video-timeout`                   | Seconds per video hand-off, or per encode wait with `--wait`, 60 to 86400 (default 5400)                             |
| `--processing-timeout`              | With `--wait`, seconds per encode, 60 to 86400 (default 3600); raises `--video-timeout` when larger                  |

**Re-running is safe.** Every imported video carries a per-source metaTag (`vimeoId`, `s3Source`, `wistiaId`, `muxAssetId`, `cfStreamId`, `jwPlayerId`, `brightcoveId`). A re-run skips tagged videos Bunny has finished, leaves ones still encoding alone, and imports again only the ones Bunny failed on. Source folders become Stream collections of the same name. Videos the source reports as beyond Bunny's limits (over 72 hours, or above 2160p) are flagged before you confirm.

**Progress** is saved to `$XDG_STATE_HOME/bunnynet/stream-import/<account>/<source>-<library>.json` (default `~/.local/state/...`). `--resume` retries failed videos, works outstanding ones, and keeps the `--folder` scope the run started with. It does **not** retry videos Bunny rejected for a reason the same file cannot get past (over limits, invalid framerate, corrupt original), ones no longer at the source, or ones that failed 3 times; use `--clean-failed` for those. Two imports cannot share one state file.

**Ctrl-C** stops queuing new videos, saves progress, prints the `--resume` command, and exits 130. A second Ctrl-C exits at once.

**Exit codes:** 0 when everything was queued (or finished with `--wait`), 1 when any video failed (they are listed with Bunny's reason; in a terminal it offers to retry them), 130 when paused.

### JSON output

Every `--output json` document carries an `outcome`:

- `no_videos`, `nothing_new`, `dry_run`: stopped before importing. Shape `{ outcome, library, source, folder, dryRun, truncated, summary }`; `summary` holds the counts (including `processingOnBunny`) and name lists (capped at 10000; `truncated` says when).
- `imported`, `paused`: shape `{ outcome, library, source, folder, dryRun, status, waited, queued, completed, processing, failed, collections, warnings, statePath, elapsedMs }`, each `failed` entry `{ name, sourceId, error }`. On `paused`, `library` and `statePath` may be null if it stopped before reaching them.

Declining the confirmation prints nothing.

---

## `bunny stream import list`: Browse a source

```bash
bunny stream import list --source vimeo                 # folders: ID, name, video count
bunny stream import list --source vimeo --videos        # every video, with folder, duration, size
bunny stream import list --source vimeo --folder 987654 # videos in one folder
bunny stream import list --source s3 --bucket my-videos --prefix 2024/
```

Resolves the source and credentials the same way an import does and needs no library. The folder IDs it prints are what `--folder` takes. JSON: `{ source, supportsFolders, folders, uncategorized, videos, truncated }`.

---

## `bunny stream import status`: Check a queued import

```bash
bunny stream import status --library 12345
bunny stream import status --library 12345 --source s3 --output json
```

Reads the saved run (pass `--source` when more than one platform was imported into the library), asks Bunny for the current state of every video it queued, and prints Bunny's status, encode percentage, size, and when each was queued. A video still processing with no data after 30 minutes is marked `(stalled?)`: re-run the import with `--retry-stalled` to delete and fetch it again. Exits 1 when any video failed, so it works as a poll in scripts. JSON: `{ library, source, status, completed, processing, failed, stalled, stalledAfterMinutes, saved, videos }`.

---

## Anti-patterns

- **Passing credentials as flags or pasting them into commands.** They are read from environment variables only; export them (or use a `.env` the shell loads) instead.
- **Importing without a dry run.** Run `import list` and `--dry-run` first to see the folders, video counts, and what is already in Bunny.
- **Holding the command open with `--wait` in automation.** Queue with `--force`, then poll `bunny stream import status` until it exits 0; encodes can take hours.
- **Deleting the state file to "start fresh".** It is how a resume recovers videos Bunny created but never tagged; deleting it can create duplicates.
- **Treating `(stalled?)` as success.** Bunny gives no signal for a fetch that died silently; re-run with `--retry-stalled`.
- **Looping `--resume` on rejected videos.** It skips them on purpose; use `--clean-failed` once, or fix the source file.
