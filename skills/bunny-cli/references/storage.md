# Storage Commands

`bunny storage` manages Edge Storage: the zones that hold files and the files within them. The namespace is hidden from top-level help while experimental, but the commands work. Use `bunny storage <command> --help` for full flag details.

Two resource groups plus directory-level helpers:

- `bunny storage zones` (alias: `zone`; hidden: `bucket`, `buckets`): zone lifecycle, settings, S3 credentials, custom domains
- `bunny storage files` (alias: `file`): the files within a zone (list, upload, download, delete)
- `bunny storage link` / `unlink`: pin the current directory to a zone
- `bunny storage regions`: list the available region codes
- `bunny storage docs`: open the Edge Storage documentation

Two credential layers, both resolved automatically: zone management uses the account API key; file operations use the zone's own password and a region-specific host, fetched from the zone itself. Nothing extra to configure.

## Zone resolution

Zone and domains commands take an optional `[zone]` positional; file commands take a `--zone` (`-z`) flag instead (their positional is the file path). Either accepts the zone name or its numeric ID. When omitted, the zone is resolved in this order:

1. Explicit zone reference
2. `.bunny/storage.json` manifest (written by `bunny storage link`)
3. Interactive picker (errors when non-interactive: `--output json`, no TTY, or `--force`; pass a zone or link the directory in CI)

When a zone is chosen via the picker on a non-destructive command, the command offers to link the directory to it.

Prefer passing the zone explicitly (`--zone` / `[zone]`); it works from any directory and in non-interactive contexts. Linking is a convenience for a directory dedicated to one zone, letting you drop the zone from every command.

## Typical workflows

```bash
# Create a zone and work with files (zone passed explicitly)
bunny storage zones add my-zone --region DE
bunny storage files upload ./photo.png --to images/ --zone my-zone
bunny storage files list images/ --zone my-zone
bunny storage files download images/photo.png --out ./local.png --zone my-zone

# Or link the directory once, then drop the zone from file commands
bunny storage link my-zone
bunny storage files upload ./photo.png --to images/

# Create a zone that is also served on the web (pull zone + custom domain)
bunny storage zones add my-zone --region DE --pull-zone --domain cdn.example.com

# S3-compatible access (zones with S3 preview access)
bunny storage zones credentials my-zone --format rclone >> ~/.config/rclone/rclone.conf
eval "$(bunny storage zones credentials my-zone --format env)"
```

**A storage zone only holds files; a pull zone is what serves them on the web.** `zones add` offers to create one (origin set to the new storage zone) and then to add a custom domain, or pass `--pull-zone` / `--domain` to do it non-interactively. Custom domains live on the pull zone and are managed with `bunny storage zones domains`.

---

# Zones

## `bunny storage zones add`: Create a zone

```bash
bunny storage zones add                                # interactive: prompts for name and region
bunny storage zones add my-zone --region DE
bunny storage zones add my-zone --region NY --replication LA,SG
bunny storage zones add my-zone --region DE --pull-zone
bunny storage zones add my-zone --region DE --domain cdn.example.com   # implies --pull-zone
```

| Flag               | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `--region`         | Main region code (e.g. `DE`, `NY`, `LA`, `SG`); run `storage regions` to list |
| `--replication`    | Replication region codes (comma-separated or repeated)                        |
| `--pull-zone`      | Also create a pull zone to serve the storage zone over the web                |
| `--pull-zone-name` | Name for the pull zone (defaults to the storage zone name)                    |
| `--domain`         | Custom domain to add to the pull zone (implies `--pull-zone`)                 |
| `--force`          | Skip prompts and confirmations (use flag values only)                         |

**Gotchas:**

- The main region cannot be changed after creation.
- Replication regions are **permanent once added** (there is no API to remove one) and each adds storage cost, so the command confirms before creating a zone with any. The confirmation defaults to no.
- Region and replication both affect pricing.
- With `--domain`, the interactive flow walks through DNS setup and SSL; under `--output json` the domain is attached without prompts and SSL is issued later via `domains ssl` once DNS points at bunny.

## `bunny storage zones list` / `show`

```bash
bunny storage zones list                               # alias: ls
bunny storage zones show my-zone
bunny storage zones show                               # linked zone, or pick interactively
```

When the zone has S3 preview access, `show` surfaces the S3 endpoint and hints at `credentials` for the keys.

## `bunny storage zones update`: Edit zone settings

Interactive editor pre-filled with current values when run without flags; flags make it non-interactive (a partial set of flags is a partial update). Non-interactive contexts require at least one flag.

```bash
bunny storage zones update my-zone                     # interactive editor
bunny storage zones update my-zone --custom-404-path /404.html
bunny storage zones update my-zone --custom-404-path ""   # clear the custom 404
bunny storage zones update my-zone --replication LA,SG
```

| Flag                   | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `--custom-404-path`    | File returned for missing files (empty string clears) |
| `--rewrite-404-to-200` | Rewrite 404 responses to 200 for extensionless URLs   |
| `--replication`        | Replication region codes to add (additive; see below) |
| `--force`              | Skip prompts and confirmations                        |

Replication is **additive only**: existing replicas can never be removed, so the final set is always the existing regions plus any new picks. Omitting an existing region from `--replication` prints a warning and keeps it; adding new regions confirms first (permanent, adds cost).

## `bunny storage zones remove`: Delete a zone

Deletes the zone **and all of its files**. Double confirmation unless `--force`: a yes/no prompt, then typing the zone name. Also removes a `.bunny/storage.json` that pointed at the deleted zone.

```bash
bunny storage zones remove my-zone                     # alias: rm
bunny storage zones remove my-zone --force
```

## `bunny storage zones credentials`: S3-compatible credentials

Alias: `creds`. bunny.net's S3-compatible API is in closed preview and opt-in per zone (it cannot be enabled on an existing zone); the command warns when the zone lacks access. The endpoint is `https://<region>-s3.storage.bunnycdn.com`, the access key is the zone name, and the secret is the zone password, so there is nothing new to rotate beyond the zone's own credentials.

```bash
bunny storage zones credentials my-zone                # table: endpoint + keys (secret masked)
bunny storage zones credentials my-zone --show-secret  # reveal the secret
bunny storage zones credentials my-zone --read-only    # use the read-only password as the secret
bunny storage zones credentials my-zone --format rclone >> ~/.config/rclone/rclone.conf
bunny storage zones credentials my-zone --format aws   # AWS CLI profile snippet
bunny storage zones credentials my-zone --format s3cmd
eval "$(bunny storage zones credentials my-zone --format env)"   # AWS_* env vars
```

| Flag            | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `--format`      | Emit ready-to-use config: `rclone`, `aws`, `s3cmd`, or `env`                |
| `--read-only`   | Use the zone's read-only password as the secret access key                  |
| `--show-secret` | Reveal the secret (masked by default in both the table and `--output json`) |

`--format` output always contains the full secret (it is meant to be consumed by tools).

## `bunny storage zones domains`: Custom domains

Hidden alias: `hostnames`. Domains attach to the storage zone's **pull zone**; if the zone has none, create one with `zones add --pull-zone`. When the zone has multiple pull zones, pass `--pull-zone <id>` to choose.

```bash
bunny storage zones domains list my-zone
bunny storage zones domains add cdn.example.com my-zone
bunny storage zones domains ssl cdn.example.com my-zone
bunny storage zones domains remove cdn.example.com my-zone
```

`add` walks through DNS (CNAME to the pull zone's system hostname) and offers free SSL; `--ssl`/`--wait` control the follow-up, `--force-ssl` redirects HTTP to HTTPS. `ssl` issues the certificate later, once DNS resolves to bunny. `remove` confirms unless `--force`.

---

# Files

File commands use the zone's storage password against a region-specific host (both resolved from the zone automatically) and are powered by `@bunny.net/storage-sdk`. Paths are relative to the zone root. **A trailing slash denotes a directory**: `--to images/` uploads into it, `remove images/` deletes it and its contents recursively.

Every file command takes `--zone` (`-z`); it can be omitted only in a directory linked with `bunny storage link` (or interactively via the picker).

## `bunny storage files list`

```bash
bunny storage files list --zone my-zone                # zone root (alias: ls)
bunny storage files list images/ --zone my-zone        # a directory
bunny storage files list images/                       # linked zone
```

## `bunny storage files upload`

```bash
bunny storage files upload ./photo.png --zone my-zone  # to the zone root, same name
bunny storage files upload ./photo.png --to images/ --zone my-zone
bunny storage files upload ./photo.png --to images/renamed.png --zone my-zone
bunny storage files upload ./photo.png --checksum --content-type image/png --zone my-zone
bunny storage files upload ./photo.png --to images/    # linked zone
```

| Flag             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `--to`           | Remote path; a trailing slash uploads into that directory |
| `--content-type` | Override the stored content type                          |
| `--checksum`     | Send a SHA256 checksum so the server verifies the upload  |
| `--zone`, `-z`   | Storage zone name or ID (defaults to the linked zone)     |

## `bunny storage files download`

```bash
bunny storage files download images/photo.png --zone my-zone   # to ./photo.png
bunny storage files download images/photo.png --out ./local.png --zone my-zone
bunny storage files download images/photo.png          # linked zone
```

## `bunny storage files remove`

Confirms unless `--force`. A trailing slash deletes the directory recursively.

```bash
bunny storage files remove images/photo.png --zone my-zone     # alias: rm
bunny storage files remove images/ --force --zone my-zone      # directory + contents, no prompt
```

---

# Directory linking and regions

## `bunny storage link` / `unlink`

Link the current directory to a zone (`.bunny/storage.json`) so storage commands resolve it without an explicit zone.

```bash
bunny storage link my-zone                             # by name or ID
bunny storage link                                     # pick interactively
bunny storage unlink                                   # confirms unless --force
```

## `bunny storage regions`

Lists the available storage region codes (e.g. `DE`, `NY`, `LA`, `SG`). Replication uses these same regions, minus the zone's primary.

```bash
bunny storage regions
bunny storage regions --output json
```
