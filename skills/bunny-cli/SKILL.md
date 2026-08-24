---
name: bunny-cli
description: Manage bunny.net resources from the command line (databases, DNS, Edge Scripts, static sites, sandboxes, authentication, and raw API requests). Use when working with bunny.net (pullzones, DNS zones/records, databases, Edge Scripts, Magic Containers, static-site hosting/deploys, cloud sandboxes), invoking the `bunny` CLI, or making authenticated API calls to api.bunny.net.
---

# bunny.net CLI Skill

The bunny.net CLI (`bunny`) manages bunny.net resources from the command line. Use `bunny <command> --help` for full flag details on any command.

## Critical: Authentication

Commands require an API key. Authenticate first with `bunny login`, which opens a browser-based auth flow and stores the key in a local profile. Alternatively, set `BUNNYNET_API_KEY` as an environment variable or pass `--api-key` directly.

Config is stored in (first match wins):

- `$XDG_CONFIG_HOME/bunnynet.json`
- `~/.config/bunnynet.json`
- `~/.bunnynet.json`
- `/etc/bunnynet.json`

**When something goes wrong, check auth first**: run a quick `bunny api GET /user` to verify your key works. If using profiles, confirm the right one is active with `--profile`.

## Quick Start

```bash
# authenticate
bunny login

# install this skill for AI coding tools (AGENTS.md + .claude/skills; --global for ~/.claude/skills)
bunny skills install

# make a raw API request
bunny api GET /pullzone
bunny api GET /user

# manage databases
bunny db create
bunny db list
bunny db shell
bunny db migrations apply                             # run pending migrations/*.sql files
bunny db migrations apply --pattern "*/migration.sql" # opt into a nested ORM layout

# manage Edge Scripts
bunny scripts init
bunny scripts deploy dist/index.js
bunny scripts list

# manage cloud sandboxes (isolated containers with Claude Code inside)
bunny sandbox create my-sandbox -e ANTHROPIC_API_KEY=sk-ant-...
bunny sandbox exec my-sandbox -- bun install
bunny sandbox url add my-sandbox 3000

# manage DNS
bunny dns zones add example.com
bunny dns zones nameservers example.com               # is the registrar delegated to bunny yet?
bunny dns records add example.com api A 198.51.100.1
bunny dns records preset google-workspace example.com # apply a preset record set
bunny dns records list example.com

# host a static site
bunny sites create my-site                            # provision (served at sites-my-site-<suffix>.b-cdn.net)
bunny sites deploy ./dist                             # immutable preview URL (sites-dpl-<id>-<suffix>.b-cdn.net); first deploy offers to publish
bunny sites deploy ./dist --production                # publish as the live site
bunny sites domains add example.com --wait            # custom production domain (previews never need one)
bunny sites deployments publish --previous --force    # instant rollback
```

## Decision Tree

Use this to route to the correct reference file:

- **Authenticate or switch profiles** -> `references/auth.md`
- **Database management (create, list, show, link, delete, shell, studio, migrations, regions, tokens)** -> `references/database.md`
- **DNS (zones, delegation checks, records, presets, BIND import/export, DNSSEC, logging, Scriptable DNS scripts)** -> `references/dns.md`
- **Edge Scripts (init, create, deploy, link, stats, deployments/rollback, env vars, custom domains)** -> `references/scripts.md`
- **Static sites (create, deploy, rollback, custom domains, domain-gated previews, GitHub Actions)** -> `references/sites.md`
- **Sandboxes (create, exec, ssh, files list/cp, public URLs, persistent env vars, Claude Code auth)** -> `references/sandbox.md`
- **Make raw API requests** -> `references/api.md`
- **CLI doesn't have a command for it** -> use `bunny api` as a fallback (see `references/api.md`)

## Global Flags

Available on every command:

| Flag        | Short | Default   | Description                                               |
| ----------- | ----- | --------- | --------------------------------------------------------- |
| `--profile` | `-p`  | `default` | Configuration profile to use                              |
| `--verbose` | `-v`  | `false`   | Enable verbose/debug output                               |
| `--output`  | `-o`  | `text`    | Output format: `text`, `json`, `table`, `csv`, `markdown` |
| `--api-key` |       |           | API key (takes priority over profile and env)             |

## Environment Variables

| Variable                 | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `BUNNYNET_API_KEY`       | API key (overrides profile)                                                   |
| `BUNNYNET_API_URL`       | API base URL (default: `https://api.bunny.net`)                               |
| `BUNNYNET_DASHBOARD_URL` | Dashboard URL for browser-based auth flow (default: `https://dash.bunny.net`) |
| `NO_COLOR`               | Disable colored output                                                        |

## Anti-Patterns

- **Forgetting to authenticate**: Run `bunny login` first. Without it, commands fail with a missing API key error. Use `bunny api GET /user` to verify.
- **Hardcoding API keys in scripts**: Use `BUNNYNET_API_KEY` env var or `--api-key` flag instead of embedding keys. Better yet, use `bunny login` profiles.
- **Relying on prompts in automation**: Prompts require an interactive terminal; piped answers are not supported. In scripts, CI, and agent sessions, pass every value as a flag and add `--force` to skip confirmations. A command that would need a prompt without a terminal does not wait: it fails fast with exit code 1 and names the flag to pass, so treat that as "retry with flags", never as success.
