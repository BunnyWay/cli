# Stream Commands

All Stream commands live under `bunny stream`, split into resource groups:

- **`bunny stream libraries`** (aliases `library`, `lib`) manages the video library itself, plus its `player` and `security` settings, with the account API key.
- **`bunny stream videos`** (alias `video`) manages the videos inside one library, their `captions`, and the paid `encode`, `transcribe`, and `smart`.
- **`bunny stream collections`** (alias `collection`) manages groups of videos within a library.
- **`bunny stream link`** and **`bunny stream unlink`** mirror `libraries link` and `libraries unlink`.
- **`bunny stream regions`** lists the region codes a library can replicate to.
- **`bunny stream import`** moves a library in from another platform; see `stream-import.md`.

Each library carries its own Stream API key for the video-level API. Video commands resolve it from the library automatically, so there is nothing extra to configure; the key is never printed unless you ask for it with `libraries credentials`.

## Resolving the library

`libraries` commands take the library as an optional positional (name or numeric ID). Every other stream command takes it as `--lib` (alias `--library`), because its positional is a video GUID, a collection ID, or a local file path. When omitted, the library resolves in this order:

1. Explicit name or ID
2. `.bunny/stream.json` (written by `bunny stream link`)
3. Interactive picker, which offers to link the directory (never on destructive commands)

Non-interactive runs (`--output json`, no TTY, or `--force`) error instead of prompting: pass a library or link the directory first. A `videos`, `collections`, or `videos captions` command with no ID behaves the same way. On destructive commands and `videos smart`, `--force` also disables the pickers, so it never acts on something you did not name; on `videos transcribe` that is `--overwrite`, and `videos encode` has neither.

## Typical workflows

```bash
# New library: link this directory and write BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY to .env
bunny stream libraries create my-library --link --save-env --no-add-videos

# Upload a local file, or have bunny.net fetch a URL server-side
bunny stream videos upload ./video.mp4 --title "Launch demo"
bunny stream videos fetch https://example.com/video.mp4 --header "Authorization: Bearer abc"

# Find it, check it, embed it
bunny stream videos list --search launch
bunny stream videos show 1a2b3c4d-...
bunny stream videos embed 1a2b3c4d-... --expires 1h

# Organise with collections
bunny stream collections create Tutorials
bunny stream videos update 1a2b3c4d-... --collection 8a7b6c5d-...
```

---

## `bunny stream libraries`: Libraries

```bash
bunny stream libraries list                          # ID, name, videos, storage, traffic, replication regions
bunny stream libraries create my-library             # stored in DE; asks about replicas in a terminal, none otherwise
bunny stream libraries create my-library --replication-regions NY,SG   # DE alone means no replication
bunny stream libraries create my-library --encoding-tier premium --codecs x264,vp9
bunny stream libraries show my-library               # API keys are never printed here
bunny stream libraries update my-library --resolutions 720p,1080p
bunny stream libraries update my-library --transcribing --transcribing-languages en,de
bunny stream libraries update my-library --encoding-tier premium --codecs x264,vp9   # paid; warns about billing
bunny stream libraries update my-library --add-replication-regions SYD   # add-only
bunny stream libraries credentials my-library        # library ID + API key, masked
bunny stream libraries credentials my-library --show-secret --read-only
bunny stream libraries credentials my-library --save-env   # write BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY to .env
bunny stream libraries credentials my-library --rotate   # reset the key (confirms first)
bunny stream libraries delete my-library             # deletes every video in it; confirms with the count
bunny stream regions                                 # DE is the fixed main region; SG, LA, NY the suggested replicas
bunny stream link my-library                         # same as `libraries link`
bunny stream unlink
```

`create` takes the name as its positional. After creating, it offers to link the directory, save `BUNNY_STREAM_LIBRARY_ID` and `BUNNY_STREAM_API_KEY` to `.env` (the names the Stream examples read), and add videos by importing from another platform or uploading a file. `--link`/`--no-link` and `--save-env`/`--no-save-env` answer the first two, `--no-add-videos` skips the third; non-interactive runs skip anything a flag does not set.

`update` sends only the flags you pass. With no flags it opens an interactive editor (name, resolutions, transcribing, keep original, MP4 fallback, content tagging); unattended runs need at least one flag. Rename with `update --name`.

Run `bunny stream libraries <command> --help` for every flag. The ones with consequences:

- `--encoding-tier premium` bills per output codec per minute. `--codecs` other than `x264`, and `--jit`, need it.
- `--early-play` needs `--keep-original` and exposes the originals.
- `--transcribing` bills per use on every new upload and re-encode.
- `--add-replication-regions` is add-only: regions can never be removed.
- `--content-tagging` is accepted on `update` only.
- `--force` is required for `unlink`, `delete`, `credentials --rotate`, `player reset`, and `security show --rotate` without a TTY.

### Player and security

```bash
bunny stream libraries player show my-library
bunny stream libraries player update my-library --color "#FF7755" --speeds 0.5,1.0,1.15,2.0 --heatmap
bunny stream libraries player update my-library --no-controls
bunny stream libraries player reset my-library       # dashboard defaults; confirms first
bunny stream libraries security show my-library      # token key masked
bunny stream libraries security update my-library --embed-token --block-direct-access --allow-referrer example.com
bunny stream libraries security update my-library --drm-basic
bunny stream libraries security show my-library --rotate   # reset the token key (confirms first); signed URLs stop working
```

Run `player update --help` and `security update --help` for the full flag lists; every boolean takes a `--no-` form. `security update` applies domain changes one at a time and skips ones already in place, so re-running a partly failed update is safe.

---

## `bunny stream videos`: Videos

```bash
bunny stream videos upload ./video.mp4 --lib 12345 --title "Launch demo"
bunny stream videos upload ./video.mp4 --collection 8a7b6c5d-...
bunny stream videos fetch https://example.com/video.mp4 --lib 12345
bunny stream videos list --collection 8a7b6c5d-...
bunny stream videos show 1a2b3c4d-...               # includes caption languages and the Direct Play URL
bunny stream videos update 1a2b3c4d-... --title "Launch demo"
bunny stream videos update 1a2b3c4d-... --chapters '[{"title":"Intro","start":0,"end":30}]'
bunny stream videos update 1a2b3c4d-... --collection ""   # remove from its collection
bunny stream videos thumbnail 1a2b3c4d-... --file ./thumb.jpg   # or --url
bunny stream videos resolutions 1a2b3c4d-...        # configured, encoded, and stored
bunny stream videos cleanup 1a2b3c4d-... --non-configured --dry-run
bunny stream videos stats 1a2b3c4d-... --from 2026-01-01 --to 2026-01-31
bunny stream videos embed 1a2b3c4d-... --expires 30m   # signed when embed tokens are on
bunny stream videos delete 1a2b3c4d-...
```

There is no `videos create`: add a video with `upload` (local file) or `fetch` (bunny.net downloads a URL).

- **`upload`** creates the entry, then sends the bytes. Files over 2 GB switch to resumable TUS uploads automatically. If the byte upload fails, an entry that never received bytes is deleted; one that may hold the upload is kept with a warning naming its GUID. Encoding continues after the command returns, so the status is usually `Uploaded` or `Processing`.
- **`fetch`** returns once the fetch is queued and reports no video ID; the video shows up in `videos list` once fetched.
- **`cleanup`** deletes renditions, MP4 fallbacks, or the original, and requires at least one selector (`--resolutions`, `--non-configured`, `--all`, `--original`, `--mp4`); `--outputs hls|mp4|all` only narrows which outputs those selectors touch. `--dry-run` lists what would go and skips the confirmation.

Run `bunny stream videos <command> --help` for every flag. `--force` is required for `delete` and `cleanup` without a TTY.

### Captions

```bash
bunny stream videos captions add ./captions.vtt 1a2b3c4d-... en --label "English"
bunny stream videos captions remove 1a2b3c4d-... en
```

`captions add <file> [video] [lang]` takes a local `.vtt` or `.srt` and reports the API validator's errors and warnings; `--label` defaults to the language code. `captions remove [video] [lang]` offers the video's caption languages to pick from interactively and needs `--force` without a TTY. Unattended runs need the video and the language. These are captions you wrote yourself, unrelated to the paid transcription.

---

## `bunny stream collections`: Collections

```bash
bunny stream collections list --search tut
bunny stream collections create Tutorials
bunny stream collections show 8a7b6c5d-...
bunny stream collections update 8a7b6c5d-... --name Guides
bunny stream collections delete 8a7b6c5d-...        # deletes the videos inside it too
```

Deleting a collection deletes every video in it. Move videos out first with `videos update --collection ""`.

---

## Paid commands: premium encoding, `videos encode`, `videos transcribe`, `videos smart`

```bash
bunny stream libraries update my-library --encoding-tier premium --codecs x264,vp9   # switch the library to premium encoding
bunny stream videos encode 1a2b3c4d-...             # re-encode one video with current settings (alias reencode)
bunny stream videos transcribe 1a2b3c4d-... --target-languages en,de --source-language en
bunny stream videos smart 1a2b3c4d-... --title --chapters   # generate fields from the transcript
```

All of them state the cost before running.

- **Premium encoding** bills per output codec per minute; `--jit`, `--codecs`, `--resolutions` apply in the same request. `videos encode` regenerates every output at the library's encoding rate.
- **`videos transcribe`** costs $0.10 per language-minute (source transcript plus each target). The estimate is exact with `--source-language`, a range without. `--generate-title`, `--generate-description`, `--generate-chapters`, `--generate-moments` also generate fields. `--overwrite` replaces the existing transcription and overrides the library defaults (it is sent as the API's force flag), and disables the pickers.
- **`videos smart`** needs at least one of `--title`, `--description`, `--chapters`, `--moments`. `--source-language` picks the caption track (auto-generated tracks are `<code>-auto`; `en` falls back to `en-auto`). On a video with no captions it shows the transcription cost and asks first; unattended runs stop unless `--transcribe` approves it. `--force` only disables pickers.

---

## Anti-patterns

- **Deleting a collection to "ungroup" videos.** It deletes the videos too; clear `--collection` on each video first.
- **Running `videos transcribe` on a library that transcribes automatically.** A fresh upload or `videos encode` already triggers transcription; transcribing again bills twice.
- **Using `--overwrite` on `videos transcribe` to skip a prompt.** It re-runs the transcription and overrides library defaults.
- **Expecting `videos fetch` to return a video ID.** Poll `videos list` instead.
- **Running `videos cleanup` without `--dry-run` first.** A deleted original is gone, and re-creating renditions means a paid re-encode.
- **Expecting to remove replication regions.** `--add-replication-regions` is add-only, permanently.
- **Rotating keys casually.** `credentials --rotate` and `security show --rotate` break existing integrations and signed URLs.
- **Using the old spellings.** `encode enable`, `encode reencode`, top-level `transcribe`, `smart`, and `captions`, `collections rename`, and `security reset-token` still work but are hidden; use the commands above.
