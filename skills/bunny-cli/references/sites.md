# Static Sites Commands

All site commands live under `bunny sites`. A site is one storage zone (files) + one pull zone (CDN) + one middleware router script, provisioned together by `sites create`. Deploys are immutable directories; promoting or rolling back flips a router env var and purges the cache — no files move, so it's instant.

Most commands accept an optional site (a trailing `[site]` positional, or the `--site` flag on commands whose positionals are taken, like `deploy` and `env`). When omitted, the site resolves in this order:

1. Explicit name or storage zone ID
2. `.bunny/site.json` manifest (written by `bunny sites link` or `bunny sites create`)
3. `sites.name` in `bunny.jsonc`
4. Interactive prompt (suppressed in `--output json` mode — pass a site or link the directory in CI)

## Typical workflows

```bash
# New site: provision, deploy, iterate
bunny sites create my-site                 # served at https://my-site.b-cdn.net
bunny sites deploy ./dist                  # uploads + promotes to production

# Build-and-deploy in one step (build command from bunny.jsonc or the flag)
bunny sites deploy --build                 # runs `sites.build`, deploys `sites.dir`
bunny sites deploy ./out --build "npm run build"

# Rollback
bunny sites deployments list               # find the deploy ID (● Live marks production)
bunny sites deployments publish --previous --force   # instant rollback
bunny sites deployments publish a1b2c3d4 --force     # promote a specific deploy

# Custom domain with per-deploy previews
bunny sites domains add example.com --wait # also attaches *.preview.example.com
# → production at https://example.com, previews at https://dpl-<id>.preview.example.com
```

## Deploy IDs and previews

- The deploy ID is the **git short-sha** when the working tree is clean, otherwise an 8-char **content hash**. Re-deploying identical content is a no-op (`--force` overrides).
- Every deploy stays addressable: `https://<host>/deploys/<id>/` (path preview) and, once a custom domain exists, `https://dpl-<id>.preview.<domain>` (subdomain preview, served with `X-Robots-Tag: noindex`).
- Dotfiles and `node_modules` are never uploaded.

---

## `bunny sites create` — Provision a site

```bash
bunny sites create my-site
bunny sites create my-site --region NY
bunny sites create my-site --domain example.com
bunny sites create my-site --no-link       # don't write .bunny/site.json
```

| Flag       | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| `--region` | Main storage region code (default `DE`)                            |
| `--domain` | Attach a custom domain (+ `*.preview.<domain>`) after provisioning |
| `--link`   | Link this directory (default true; `--no-link` to skip)            |

Site names become the storage zone, pull zone, and `<name>.b-cdn.net` subdomain: 3–60 lowercase letters, digits, and dashes. Creation is idempotent — a failed create re-runs cleanly, reusing whatever was already provisioned.

---

## `bunny sites deploy` — Deploy a directory

```bash
bunny sites deploy ./dist
bunny sites deploy ./dist --no-promote     # upload only; publish later
bunny sites deploy --build                 # run `sites.build` from bunny.jsonc first
bunny sites deploy ./out --build "npm run build" --env VITE_FLAG=1
```

| Flag           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `[dir]`        | Directory to deploy (default: `sites.dir` in bunny.jsonc, then cwd)  |
| `--build`      | Run a build first (bare flag uses `sites.build` from bunny.jsonc)    |
| `--env`        | Build-time env override `KEY=VALUE` (repeatable; requires `--build`) |
| `--env-file`   | Dotenv file of build-time overrides (requires `--build`)             |
| `--no-promote` | Upload without pointing production at it                             |
| `--force`      | Deploy even when content is unchanged                                |
| `--site`       | Target site (name or storage zone ID)                                |

With `--build`, the site's remote env (`sites env`) is merged with `--env`/`--env-file` overrides into the build's environment, and the env fingerprint is recorded on the deploy.

---

## `bunny sites deployments` — List, publish, prune

```bash
bunny sites deployments list
bunny sites deployments publish a1b2c3d4    # confirm prompt; --force to skip
bunny sites deployments publish --previous  # instant rollback
bunny sites deployments prune --keep 10     # never prunes current/previous
```

`publish` (alias `promote`) flips production to a past deploy — the files are already on the CDN, so this is instant plus a cache purge.

---

## `bunny sites domains` — Custom domains

```bash
bunny sites domains add example.com --wait  # wait for DNS, then issue SSL
bunny sites domains ssl example.com         # issue a certificate later
bunny sites domains list
bunny sites domains remove example.com
```

Adding a domain also attaches `*.preview.<domain>` for per-deploy preview URLs (removing it takes the wildcard down too). If the domain is on a Bunny DNS zone in the account, the CLI offers to create the records; otherwise it prints the CNAME target. The wildcard certificate may need DNS in place before it can issue — re-run `bunny sites domains ssl "*.preview.<domain>"` once DNS is live.

---

## `bunny sites env` — Build-time environment variables

```bash
bunny sites env set VITE_API_URL "https://api.example.com"
bunny sites env list                        # values masked; --show reveals
bunny sites env remove VITE_API_URL
bunny sites env pull .env.local --force
```

**These are build-time values, not a secret store** — anything the build reads can end up in the shipped bundle. They are stored inside the site's storage zone (never served) and merged into `sites deploy --build` runs.

---

## `bunny sites` lifecycle and maintenance

```bash
bunny sites list
bunny sites show                            # resources, domains, current deploy; warns on old router
bunny sites link my-site                    # .bunny/site.json
bunny sites unlink
bunny sites upgrade                         # republish the router at the CLI's latest version
bunny sites delete my-site                  # typed-name confirmation; --keep-storage keeps files
```

## `bunny.jsonc` integration

An optional `sites` block configures the deploy defaults (validated on its own, so a sites-only file works without an `app` block):

```jsonc
{
  "sites": {
    "name": "my-site", // resolves the site when nothing is linked
    "dir": "./dist", // default deploy directory
    "build": "npm run build", // command for `deploy --build`
  },
}
```

## CI / agents

- Pass `--force` on anything with a confirmation (publish, prune, remove, delete).
- Pass the site explicitly (or commit `bunny.jsonc` with `sites.name`) — the interactive picker is disabled under `--output json`.
- `--output json` on every command emits machine-readable results (deploy prints `{ id, production, preview, promoted }`).
