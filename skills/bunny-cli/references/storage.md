# Edge Storage Commands

> The `bunny storage` namespace is experimental: it works, but it's hidden from `bunny --help` while it stabilizes. Command and flag names may still change.

All storage commands live under `bunny storage`, split into two resource groups:

- **`bunny storage zones`** (alias `zone`, hidden `bucket`/`buckets`) manages the zone itself with the account API key.
- **`bunny storage files`** (alias `file`) manages the files inside a zone, using the zone's own password against a region-specific host. Both are resolved from the zone automatically, so there is nothing to configure.

A storage zone only holds files. A **pull zone** is what serves them on the web, and custom domains live on the pull zone (`bunny storage zones domains`), not on the storage zone.

## Resolving the zone

`zones` commands take the zone as an optional `[zone]` positional. `files` commands take it as `--zone`/`-z`, because their positional is the file path. Either accepts the zone name or its numeric ID. When omitted, the zone resolves in this order:

1. Explicit name or numeric ID
2. `.bunny/storage.json` (written by `bunny storage link`)
3. Interactive picker, which offers to link the directory to the zone it picked (never on destructive commands)

Non-interactive runs (`--output json`, no TTY, or `--force`) error instead of prompting. Pass a zone or link the directory first.

## Typical workflows

```bash
# New zone, served on the web, credentials in .env
bunny storage zones add my-zone --region DE --domain cdn.example.com \
  --connection s3 --save-env --link

# Push a build up and check it landed
bunny storage files upload ./dist/app.js --to assets/ --content-type application/javascript
bunny storage files list assets/

# Hand credentials to another tool
eval "$(bunny storage zones credentials my-zone --format env)"
bunny storage zones credentials my-zone --format rclone >> ~/.config/rclone/rclone.conf
```

---

## `bunny storage zones list` — List storage zones

```bash
bunny storage zones list
bunny storage zones list --output json
```

Reports name, ID, main region, tier, and S3 support per zone.

---

## `bunny storage zones add` — Create a storage zone

```bash
bunny storage zones add                                              # interactive
bunny storage zones add my-zone --region DE
bunny storage zones add my-zone --region NY --replication LA,SG
bunny storage zones add my-zone --region DE --pull-zone              # also serve it on the web
bunny storage zones add my-zone --region DE --domain cdn.example.com # pull zone + custom domain
bunny storage zones add my-zone --tier ssd --s3                      # Edge tier with S3 access
bunny storage zones add my-zone --region DE --connection s3 --save-env
```

### Flags

| Flag               | Description                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `--region`         | Main storage region code (e.g. `DE`, `NY`, `LA`, `SG`). Run `bunny storage regions` to list |
| `--replication`    | Replication region codes, comma-separated or repeated (any region except the primary)       |
| `--tier`           | `hdd` (Standard) or `ssd` (Edge)                                                            |
| `--s3`             | Enable S3-compatible API access                                                             |
| `--pull-zone`      | Also create a pull zone with this storage zone as its origin                                |
| `--pull-zone-name` | Name for that pull zone (defaults to the storage zone name)                                 |
| `--domain`         | Custom domain to add to the pull zone (implies `--pull-zone`)                               |
| `--link`           | Link this directory to the new zone. `--no-link` skips without prompting                    |
| `--connection`     | Print connection details for `http`, `ftp`, or `s3`                                         |
| `--format`         | Emit client config instead of a table: `sdk`, `rclone`, `aws`, `s3cmd`, `env`               |
| `--save-env`       | Write the connection details to `.env` (needs `--connection`)                               |
| `--force`          | Skip prompts and confirmations, using flag values only                                      |

**Create-time only**: the tier, the main region, and S3 compatibility are all fixed once the zone exists, so interactive `add` prompts for each when its flag is omitted, and none of them can be changed later. Edge (SSD) zones are always primaried in `DE`, so `--tier ssd` rejects any other `--region` rather than letting the API rewrite it silently. Replication regions are unaffected.

After creating the zone, interactive `add` offers to link the directory, print connection details, and save them to `.env`. Credentials print in full here because they were explicitly asked for; `zones credentials` masks them by default.

---

## `bunny storage zones show` — Inspect a zone

```bash
bunny storage zones show my-zone
bunny storage zones show                    # linked zone
bunny storage zones show my-zone --output json
```

Reports the zone's settings, its tier, whether S3 is enabled, and the S3 endpoint when it is.

---

## `bunny storage zones update` — Edit zone settings

```bash
bunny storage zones update my-zone                              # interactive, pre-filled
bunny storage zones update my-zone --custom-404-path /404.html
bunny storage zones update my-zone --replication SG
```

Only the settings that aren't create-time can change here (see `--help` for the full list). **Replication is additive**: bunny.net has no API to remove a replication region once added, so `update` only offers regions the zone doesn't have, unions the flags with the current set, warns when an existing region is omitted rather than dropping it, and confirms before adding.

---

## `bunny storage zones remove` — Delete a zone

```bash
bunny storage zones remove my-zone          # confirms twice
bunny storage zones remove my-zone --force  # skip both confirmations
```

Deletes the zone and everything in it. Interactively it confirms twice: yes/no, then typing the zone name.

---

## `bunny storage zones credentials` — Connection details

```bash
bunny storage zones credentials my-zone                                # pick a protocol, secret masked
bunny storage zones credentials my-zone --connection ftp --show-secret
bunny storage zones credentials my-zone --connection s3 --read-only
bunny storage zones credentials my-zone --format sdk                   # storage SDK snippet
bunny storage zones credentials my-zone --format rclone >> ~/.config/rclone/rclone.conf
eval "$(bunny storage zones credentials my-zone --format env)"
bunny storage zones credentials my-zone --connection http --save-env
```

A zone has one password, shaped per protocol:

| `--connection` | What it prints                                                           |
| -------------- | ------------------------------------------------------------------------ |
| `http`         | Base URL and the `AccessKey` header                                      |
| `ftp`          | Host, username, password                                                 |
| `s3`           | Endpoint, region, access key (the zone name), secret (the zone password) |

### Flags

| Flag            | Description                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `--connection`  | `http`, `ftp`, or `s3` (prompts when omitted)                                             |
| `--format`      | Client config: `sdk` (HTTP API), `rclone`, `aws`, `s3cmd`, `env` (S3). Implies a protocol |
| `--read-only`   | Use the zone's read-only password as the secret                                           |
| `--show-secret` | Reveal the masked secret in table and JSON output                                         |
| `--save-env`    | Write the protocol's variables into whichever `.env` already holds one of them            |

`--format` implies its protocol, so a conflicting `--connection` is an error. `--format` always emits the secret in full, since the output is meant to be piped into a tool; under `--output json` the config rides along in a `config` field. `--save-env` writes `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, and `BUNNY_STORAGE_REGION`, or the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_ENDPOINT_URL` / `AWS_REGION` quad for S3.

The S3 access key and secret are just the zone's existing name and password, so there is nothing extra to rotate beyond the zone's own credentials.

---

## `bunny storage files` — Files within a zone

```bash
bunny storage files list --zone my-zone
bunny storage files list images/                    # linked zone
bunny storage files upload ./photo.png --to images/
bunny storage files upload ./photo.png --checksum --content-type image/png
bunny storage files download images/photo.png --out ./local.png
bunny storage files remove images/photo.png
bunny storage files remove images/ --force          # trailing slash removes a directory
```

Paths are relative to the zone root. **A trailing slash means directory**: `files list images/` lists that directory, and `files remove images/` deletes it and its contents recursively.

| Flag             | Commands         | Description                                               |
| ---------------- | ---------------- | --------------------------------------------------------- |
| `--zone`, `-z`   | all `files`      | Zone name or ID (defaults to the linked zone)             |
| `--to`           | `files upload`   | Remote path; a trailing slash uploads into that directory |
| `--checksum`     | `files upload`   | Send a SHA256 checksum for server-side verification       |
| `--content-type` | `files upload`   | Content type to store the file as                         |
| `--out`          | `files download` | Local destination (defaults to the file name)             |
| `--force`        | `files remove`   | Skip the confirmation prompt                              |

There is no per-file cache header: cache policy lives on the pull zone (edge rules), not on the stored object.

---

## `bunny storage zones domains` — Custom domains

```bash
bunny storage zones domains list my-zone
bunny storage zones domains add cdn.example.com my-zone
bunny storage zones domains ssl cdn.example.com my-zone
bunny storage zones domains remove cdn.example.com my-zone
```

These act on the pull zone linked to the storage zone, since that's where hostnames live. The CLI only creates a pull zone during `zones add --pull-zone`; for a zone that has none, create one with the storage zone as its origin in the dashboard. When a zone has several pull zones, pass `--pull-zone <id>` to choose.

`add` prints the DNS record to create and can wait for propagation; `ssl` requests the certificate once DNS resolves to bunny.net. `hostnames` works as a hidden alias for `domains`.

---

## `bunny storage link` / `unlink` — Directory linking

```bash
bunny storage link my-zone       # writes .bunny/storage.json
bunny storage link               # interactive picker
bunny storage unlink
bunny storage unlink --force     # skip the confirmation
```

`.bunny/storage.json` is per-developer state and gitignored, not shared config.

---

## `bunny storage regions` — List storage regions

```bash
bunny storage regions
bunny storage regions --output json
```

Use this to find valid `--region` and `--replication` codes.

---

## `bunny storage docs` — Open the documentation

```bash
bunny storage docs
```

Opens the Edge Storage docs in a browser. Like other browser helpers, it has no `--output json`.

## Anti-Patterns

- **Expecting to change the tier, main region, or S3 support later**: all three are create-time only. Getting them wrong means creating a new zone and copying the files.
- **Adding a replication region "to try it"**: replicas cannot be removed. There is no API for it, so the only undo is deleting the zone.
- **Putting a custom domain on the storage zone**: domains live on the pull zone. Use `bunny storage zones domains`, and create a pull zone first (`zones add --pull-zone`) if the zone has none.
- **Setting per-file cache headers**: `files upload` takes `--content-type` and `--checksum` only. Cache behavior is a pull zone concern.
- **Relying on the interactive picker in CI**: `--output json`, a closed stdin, and `--force` all suppress it. Pass `--zone`/`[zone]`, or link the directory.
