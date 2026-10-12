# Stream Commands

> **Experimental.** `bunny stream` is hidden from `--help` while it stabilizes. Flags and JSON shapes may still change.

All Stream commands live under `bunny stream`, split into resource groups:

- **`bunny stream library`** (aliases `libraries`, `lib`) manages the video library itself, plus its `player` and `security` settings, with the account API key.
- **`bunny stream video`** (alias `videos`) manages the videos inside one library.
- **`bunny stream collection`** (alias `collections`) manages groups of videos within a library.
- **`bunny stream caption`** (alias `captions`) manages caption files on one video.
- **`bunny stream encode`**, **`bunny stream transcribe`**, and **`bunny stream smart`** are paid operations.
- **`bunny stream import`** moves a library in from another platform; see `stream-import.md`.

Each library carries its own Stream API key for the video-level API. Video commands resolve it from the library automatically, so there is nothing extra to configure; the key is never printed unless you ask for it with `library credentials`.

## Resolving the library

`library` commands take the library as an optional positional (name or numeric ID). Every other stream command takes it as `--lib` (alias `--library`), because its positional is a video GUID, a collection ID, or a local file path. When omitted, the library resolves in this order:

1. Explicit name or ID
2. `.bunny/stream.json` (written by `bunny stream library link`)
3. Interactive picker, which offers to link the directory (never on destructive commands)

Non-interactive runs (`--output json`, no TTY, or `--force`) error instead of prompting: pass a library or link the directory first. A `video` or `collection` command with no ID behaves the same way. `caption` commands always need the video GUID as a positional.

## Typical workflows

```bash
# New library, linked to this directory
bunny stream library create my-library
bunny stream library link my-library

# Upload a local file, or have bunny.net fetch a URL server-side
bunny stream video upload ./video.mp4 --title "Launch demo"
bunny stream video fetch https://example.com/video.mp4 --header "Authorization: Bearer abc"

# Find it, check it, embed it
bunny stream video list --search launch
bunny stream video show 1a2b3c4d-...
bunny stream video embed 1a2b3c4d-... --expires 1h

# Organise with collections
bunny stream collection create --name Tutorials
bunny stream video update 1a2b3c4d-... --collection 8a7b6c5d-...
```

---

## `bunny stream library`: Libraries

```bash
bunny stream library list                          # ID, name, videos, storage, traffic, replication regions
bunny stream library create my-library             # stored in DE, replicated to SG, LA, NY by default
bunny stream library create my-library --replication-regions NY,SG   # DE alone means no replication
bunny stream library create my-library --encoding-tier premium --codecs x264,vp9
bunny stream library show my-library               # API keys are never printed here
bunny stream library update my-library --resolutions 720p,1080p
bunny stream library update my-library --transcribing --transcribing-languages en,de
bunny stream library update my-library --add-replication-regions SYD   # add-only
bunny stream library credentials my-library        # library ID + API key, masked
bunny stream library credentials my-library --show-secret --read-only
bunny stream library credentials my-library --rotate   # reset the key (confirms first)
bunny stream library link my-library
bunny stream library unlink
bunny stream library delete my-library             # deletes every video in it; confirms with the count
```

`update` sends only the flags you pass. With no flags it opens an interactive editor (name, resolutions, transcribing); unattended runs need at least one flag.

Run `bunny stream library <command> --help` for every flag. The ones with consequences:

- `--codecs` other than `x264`, and `--jit`, need `--encoding-tier premium` (billed per codec per minute).
- `--early-play` needs `--keep-original` and exposes the originals.
- `--transcribing` bills per use on every new upload and re-encode.
- `--add-replication-regions` is add-only: regions can never be removed.
- `--content-tagging` is accepted on `update` only.
- `--force` is required for `update`, `unlink`, `delete`, and `credentials --rotate` without a TTY.

### Player and security

```bash
bunny stream library player show my-library
bunny stream library player update my-library --color "#FF7755" --speeds 0.5,1.0,1.15,2.0 --heatmap
bunny stream library player update my-library --no-controls
bunny stream library player reset my-library       # dashboard defaults; confirms first
bunny stream library security show my-library      # token key masked
bunny stream library security update my-library --embed-token --block-direct-access --allow-referrer example.com
bunny stream library security update my-library --drm-basic
bunny stream library security reset-token my-library   # signed URLs stop working
```

Run `player update --help` and `security update --help` for the full flag lists; every boolean takes a `--no-` form. `security update` applies domain changes one at a time and skips ones already in place, so re-running a partly failed update is safe.

---

## `bunny stream video`: Videos

```bash
bunny stream video upload ./video.mp4 --lib 12345 --title "Launch demo"
bunny stream video upload ./video.mp4 --collection 8a7b6c5d-...
bunny stream video fetch https://example.com/video.mp4 --lib 12345
bunny stream video list --collection 8a7b6c5d-...
bunny stream video show 1a2b3c4d-...               # includes caption languages and the Direct Play URL
bunny stream video update 1a2b3c4d-... --title "Launch demo"
bunny stream video update 1a2b3c4d-... --chapters '[{"title":"Intro","start":0,"end":30}]'
bunny stream video update 1a2b3c4d-... --collection ""   # remove from its collection
bunny stream video thumbnail 1a2b3c4d-... --file ./thumb.jpg   # or --url
bunny stream video resolutions 1a2b3c4d-...        # configured, encoded, and stored
bunny stream video cleanup 1a2b3c4d-... --non-configured --dry-run
bunny stream video stats 1a2b3c4d-... --from 2026-01-01 --to 2026-01-31
bunny stream video embed 1a2b3c4d-... --expires 30m   # signed when embed tokens are on
bunny stream video delete 1a2b3c4d-...
```

There is no `video create`: add a video with `upload` (local file) or `fetch` (bunny.net downloads a URL).

- **`upload`** creates the entry, then sends the bytes. Files over 2 GB switch to resumable TUS uploads automatically. If the byte upload fails, an entry that never received bytes is deleted; one that may hold the upload is kept with a warning naming its GUID. Encoding continues after the command returns, so the status is usually `Uploaded` or `Processing`.
- **`fetch`** returns once the fetch is queued and reports no video ID; the video shows up in `video list` once fetched.
- **`cleanup`** deletes renditions, MP4 fallbacks, or the original, and requires at least one selector (`--resolutions`, `--non-configured`, `--all`, `--original`, `--mp4`, `--outputs hls|mp4|all`). `--dry-run` lists what would go and skips the confirmation.

Run `bunny stream video <command> --help` for every flag. `--force` is required for `delete` and `cleanup` without a TTY.

---

## `bunny stream collection` and `bunny stream caption`

```bash
bunny stream collection list --search tut
bunny stream collection create --name Tutorials
bunny stream collection show 8a7b6c5d-...
bunny stream collection rename 8a7b6c5d-... Guides
bunny stream collection delete 8a7b6c5d-...        # deletes the videos inside it too

bunny stream caption add 1a2b3c4d-... en --file ./captions.vtt --label "English"
bunny stream caption delete 1a2b3c4d-... en
```

Deleting a collection deletes every video in it. Move videos out first with `video update --collection ""`. `caption add` takes a local `.vtt` or `.srt` and reports the API validator's errors and warnings.

---

## Paid commands: `encode`, `transcribe`, `smart`

```bash
bunny stream encode enable --codecs x264,vp9       # switch the library to premium encoding
bunny stream encode reencode 1a2b3c4d-...          # re-encode one video with current settings
bunny stream transcribe 1a2b3c4d-... --languages en,de --source-language en
bunny stream smart 1a2b3c4d-... --title --chapters # generate fields from the transcript
```

All three state the cost before running.

- **`encode enable`** bills per output codec per minute; `--jit`, `--codecs`, `--resolutions` apply in the same request. `encode reencode` bills at the same rate.
- **`transcribe`** costs $0.10 per language-minute (source transcript plus each target). The estimate is exact with `--source-language`, a range without. `--generate-title`, `--generate-description`, `--generate-chapters`, `--generate-moments` also generate fields. **`--force` here is the API's force flag** (re-run and override library defaults), not a confirmation skip.
- **`smart`** needs at least one of `--title`, `--description`, `--chapters`, `--moments`. `--source-language` picks the caption track (auto-generated tracks are `<code>-auto`; `en` falls back to `en-auto`). On a video with no captions it shows the transcription cost and asks first; unattended runs stop unless `--transcribe` approves it. `--force` only disables pickers.

---

## Anti-patterns

- **Deleting a collection to "ungroup" videos.** It deletes the videos too; clear `--collection` on each video first.
- **Running `stream transcribe` on a library that transcribes automatically.** A fresh upload or `encode reencode` already triggers transcription; transcribing again bills twice.
- **Using `--force` on `transcribe` to skip a prompt.** It re-runs the transcription and overrides library defaults.
- **Expecting `video fetch` to return a video ID.** Poll `video list` instead.
- **Running `video cleanup` without `--dry-run` first.** A deleted original is gone, and re-creating renditions means a paid re-encode.
- **Expecting to remove replication regions.** `--add-replication-regions` is add-only, permanently.
- **Rotating keys casually.** `credentials --rotate` and `security reset-token` break existing integrations and signed URLs.
