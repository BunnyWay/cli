# DNS Commands

`bunny dns` manages Bunny DNS: zones, the records inside them, and Scriptable DNS scripts. The namespace is hidden from top-level help while experimental, but the commands work. Use `bunny dns <command> --help` for full flag details.

Three command groups:

- `bunny dns zones` (alias: `zone`; hidden: `domain`, `domains`): zone lifecycle, DNSSEC, logging, stats, nameservers
- `bunny dns records` (aliases: `record`, `rec`): the records within a zone
- `bunny dns scripts` (alias: `script`): Scriptable DNS scripts

## Zone resolution

Most zone and record commands take an optional `[domain]`, which is a domain name (`example.com`) or a numeric zone ID. When omitted, the zone is resolved in this order:

1. Explicit `[domain]` positional
2. `.bunny/dns.json` manifest (written by `bunny dns zones link`)
3. Interactive picker (suppressed under `--output json`; pass a domain or link the directory in CI)

When a zone is chosen via the picker, the command offers to link the directory to it (`.bunny/dns.json`). The offer is skipped under `--output json`.

## Typical workflows

```bash
# Create a zone, then point your registrar at the printed nameservers
bunny dns zones add example.com
bunny dns zones nameservers example.com

# Add records
bunny dns records add example.com api A 198.51.100.1
bunny dns records add example.com '@' MX mail.example.com 10
bunny dns records list example.com

# Back up and restore a zone as a BIND file
bunny dns records export example.com --save
bunny dns records import example.com ./example.com.zone

# Scriptable DNS: scaffold, deploy, attach to a hostname
bunny dns scripts init geo-router --example geo --deploy
cd geo-router
bunny dns scripts deploy handleQuery.js
bunny dns scripts attach example.com api --script <id>
```

---

# Zones

## `bunny dns zones add`: Create a zone

```bash
bunny dns zones add example.com
```

Prints the bunny.net nameservers to set at your registrar.

## `bunny dns zones list` / `show` / `nameservers`

```bash
bunny dns zones list                                  # all zones (alias: ls)
bunny dns zones show example.com                       # zone details
bunny dns zones nameservers example.com                # nameservers to set at your registrar (alias: ns)
```

## `bunny dns zones remove`: Delete a zone

Deletes the zone and all of its records. Confirms unless `--force`.

```bash
bunny dns zones remove example.com
bunny dns zones remove example.com --force
```

## `bunny dns zones stats`: Query statistics

Defaults to the last 30 days.

```bash
bunny dns zones stats example.com
bunny dns zones stats example.com --from 2026-05-01 --to 2026-05-31
bunny dns zones stats example.com --output json
```

| Flag     | Description                                      |
| -------- | ------------------------------------------------ |
| `--from` | Start date (YYYY-MM-DD); defaults to 30 days ago |
| `--to`   | End date (YYYY-MM-DD); defaults to today         |

## `bunny dns zones link` / `unlink`

Link the current directory to a zone (`.bunny/dns.json`) so other commands resolve it without a `[domain]`.

```bash
bunny dns zones link example.com                       # by domain or zone ID
bunny dns zones link                                   # pick interactively
bunny dns zones unlink                                 # confirms unless --force
```

## `bunny dns zones dnssec`: DNSSEC

```bash
bunny dns zones dnssec enable example.com              # enable and print the DS record
bunny dns zones dnssec disable example.com             # confirms unless --force
```

## `bunny dns zones logging`: Query logging

```bash
bunny dns zones logging enable example.com
bunny dns zones logging enable example.com --anonymize-ip --anonymization drop
bunny dns zones logging disable example.com            # confirms unless --force
```

| Flag              | Description                              |
| ----------------- | ---------------------------------------- |
| `--anonymize-ip`  | Anonymize client IPs in the logs         |
| `--anonymization` | Strategy: `onedigit` (default) or `drop` |

---

# Records

All record commands operate within a zone (see [Zone resolution](#zone-resolution)). Record types: `A`, `AAAA`, `CNAME`, `TXT`, `MX`, `REDIRECT`, `FLATTEN`, `PULLZONE`, `SRV`, `CAA`, `PTR`, `SCRIPT`, `NS`, `SVCB`, `HTTPS`, `TLSA`. Use `'@'` for the zone apex.

## `bunny dns records add`: Add a record

Runs an interactive wizard when the type is omitted. Value ordering is per-type (see examples).

```bash
bunny dns records add example.com api A 198.51.100.1
bunny dns records add example.com '@' MX mail.example.com 10
bunny dns records add example.com '@' SRV 10 0 389 sip.example.com
bunny dns records add example.com '@' CAA '0 issue "letsencrypt.org"'
bunny dns records add                                  # interactive wizard
```

| Flag          | Description                           |
| ------------- | ------------------------------------- |
| `--ttl`       | Time to live in seconds               |
| `--comment`   | Optional comment for the record       |
| `--pull-zone` | Pull zone ID (for `PullZone` records) |
| `--script`    | Edge Script ID (for `Script` records) |

## `bunny dns records list`: List records

```bash
bunny dns records list example.com                     # alias: ls
bunny dns records list example.com --output json
```

## `bunny dns records update`: Update a record

Pass the record ID (from `list`), or omit it to pick interactively. Only the flags you set are changed.

```bash
bunny dns records update example.com 123 --value 198.51.100.2
bunny dns records update example.com 123 --ttl 3600
bunny dns records update example.com 123 --disabled
bunny dns records update example.com --value 198.51.100.2   # pick the record interactively
```

| Flag                               | Description                  |
| ---------------------------------- | ---------------------------- |
| `--name`                           | Record name (`'@'` for apex) |
| `--value`                          | Record value                 |
| `--type`                           | Record type                  |
| `--ttl`                            | Time to live in seconds      |
| `--priority`, `--weight`, `--port` | MX / SRV fields              |
| `--flags`, `--tag`                 | CAA fields                   |
| `--comment`                        | Comment for the record       |
| `--disabled`                       | Disable the record           |
| `--pull-zone`, `--script`          | PullZone ID / Edge Script ID |

## `bunny dns records remove`: Remove a record

Pass the record ID, or omit to pick interactively. Confirms unless `--force`.

```bash
bunny dns records remove example.com 123               # alias: rm
bunny dns records remove example.com 123 --force
```

## `bunny dns records export` / `import`: BIND zone files

```bash
bunny dns records export example.com                   # print to stdout
bunny dns records export example.com --file ./example.zone
bunny dns records export example.com --save            # write ./example.com.zone
bunny dns records import example.com ./zonefile.txt
```

---

# Scriptable DNS scripts

`bunny dns scripts` manages Scriptable DNS scripts: code that computes a DNS answer at query time, such as geo routing, weighted or failover answers, and closest-region selection. They are separate from Edge Scripts (`bunny scripts`, a different runtime) and reuse the compute API.

Scripts resolve without an explicit ID in this order: explicit `[id]`, then `.bunny/dns-script.json` (written by `link`/`create`/`init`), then the interactive picker (errors under `--output json`).

A script only affects DNS once it backs a `SCRIPT` record on a zone. See `attach` below.

## `bunny dns scripts init`: Scaffold a project

Writes a `handleQuery` entry file, tsconfig, and `package.json` (devDep on `@bunny.net/scriptable-dns-types` for editor autocomplete) plus the manifest.

```bash
bunny dns scripts init                                 # interactive wizard
bunny dns scripts init geo-router --example geo --deploy
```

| Flag             | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| `--example`      | Starter: `empty`, `geo`, `closest`, `weighted`, `failover`, `pullzone` |
| `--deploy`       | Create the script on bunny.net after scaffolding                       |
| `--skip-install` | Skip installing editor type dependencies                               |

## `bunny dns scripts create`: Create a remote script

Creates the script on bunny.net without scaffolding. Unlike Edge Scripts, DNS scripts have no linked pull zone.

```bash
bunny dns scripts create                               # current directory name + link
bunny dns scripts create geo-router
bunny dns scripts create geo-router --no-link
```

## `bunny dns scripts deploy`: Upload and publish

```bash
bunny dns scripts deploy                               # publish the linked script's entry file
bunny dns scripts deploy handleQuery.js
bunny dns scripts deploy handleQuery.js 12345          # target a specific script
bunny dns scripts deploy --skip-publish                # stage without publishing
```

## `bunny dns scripts link` / `list`

```bash
bunny dns scripts link                                 # interactive selection, writes .bunny/dns-script.json
bunny dns scripts link 12345                           # direct link by ID
bunny dns scripts list                                 # all DNS scripts (alias: ls)
```

## `bunny dns scripts attach`: Point a hostname at a script

Bridges a script to a zone by adding a `SCRIPT` record so `name.domain` is answered by the script. This is the same result as `bunny dns records add <domain> <name> SCRIPT --script <id>`, surfaced from the script side.

```bash
bunny dns scripts attach                               # pick a zone and the linked script
bunny dns scripts attach example.com api --script 12345
bunny dns scripts attach example.com '@'               # apex, using the linked script
```

| Flag       | Description                                       |
| ---------- | ------------------------------------------------- |
| `--script` | DNS script ID (uses the linked script if omitted) |
| `--ttl`    | Time to live in seconds                           |
| `--force`  | Skip the confirmation prompt                      |

**Safety:** `attach` always confirms before writing the record. Attaching at the apex (`'@'`) prints a stronger warning naming the root domain, and any records already at that name are listed before you confirm. In non-interactive contexts (`--output json`, no TTY), `attach` refuses to write unless `--force` is passed.
