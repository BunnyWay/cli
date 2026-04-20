---
name: bunny-cli
description: Manage bunny.net resources from the command line — databases, authentication, and raw API requests
---

# Bunny CLI Skill

The Bunny CLI (`bunny`) manages bunny.net resources from the command line. Use `bunny <command> --help` for full flag details on any command.

## Critical: Authentication

Commands require an API key. Authenticate first with `bunny login`, which opens a browser-based auth flow and stores the key in a local profile. Alternatively, set `BUNNYNET_API_KEY` as an environment variable or pass `--api-key` directly.

Config is stored in (first match wins):

- `$XDG_CONFIG_HOME/bunnynet.json`
- `~/.config/bunnynet.json`
- `~/.bunnynet.json`
- `/etc/bunnynet.json`

**When something goes wrong, check auth first** — run a quick `bunny api GET /user` to verify your key works. If using profiles, confirm the right one is active with `--profile`.

## Quick Start

```bash
# authenticate
bunny login

# make a raw API request
bunny api GET /pullzone
bunny api GET /user

# manage databases
bunny db create
bunny db list
bunny db shell
```

## Decision Tree

Use this to route to the correct reference file:

- **Authenticate or switch profiles** -> `references/auth.md`
- **Database management (create, list, show, link, delete, shell, studio, regions, tokens)** -> `references/database.md`
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

| Variable                 | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `BUNNYNET_API_KEY`       | API key (overrides profile)                                      |
| `BUNNYNET_API_URL`       | API base URL (default: `https://api.bunny.net`)                  |
| `BUNNYNET_DASHBOARD_URL` | Dashboard URL for browser-base auth flow (default: `https://dash.bunny.net`) |
| `NO_COLOR`               | Disable colored output                                           |

## Anti-Patterns

- **Forgetting to authenticate**: Run `bunny login` first. Without it, commands fail with a missing API key error. Use `bunny api GET /user` to verify.
- **Hardcoding API keys in scripts**: Use `BUNNYNET_API_KEY` env var or `--api-key` flag instead of embedding keys. Better yet, use `bunny login` profiles.
- **Forgetting `--force` in CI/CD**: Interactive prompts block in non-TTY environments. Use `--force` to skip confirmations in automated pipelines.
