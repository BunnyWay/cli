# Static Sites Commands

All site commands live under `bunny sites`. A site is one storage zone (files) + one pull zone (CDN) + one middleware router script, provisioned together by `sites create`. Deploys are immutable directories; promoting or rolling back flips a router env var and purges the cache; no files move, so it's instant.

Most commands accept an optional site (a trailing `[site]` positional, or the `--site` flag on commands whose positionals are taken, like `deploy`). When omitted, the site resolves in this order:

1. Explicit name or storage zone ID
2. `.bunny/site.json` manifest (written by `bunny sites link` or `bunny sites create`)
3. `sites.name` in `bunny.jsonc`
4. Interactive prompt (suppressed in `--output json` mode, and on destructive commands run with `--force`; pass a site or link the directory in CI)

## Typical workflows

```bash
# New site: provision, deploy, iterate
bunny sites create my-site                 # served at https://sites-my-site-<suffix>.b-cdn.net
bunny sites deploy ./dist                  # uploads to a preview URL
bunny sites deploy ./dist --production     # uploads + publishes as the live site

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
- Every deploy stays addressable: `https://<host>/deploys/<id>/` (path preview) and, once a custom domain exists, `https://dpl-<id>.preview.<domain>` (subdomain preview). The router rewrites root-absolute asset URLs in path-preview HTML (via HTMLRewriter), so sites whose assets use absolute paths (Jekyll, most SSGs) render correctly under the `/deploys/<id>/` subpath. Both preview forms are served `X-Robots-Tag: noindex`.
- Dotfiles and `node_modules` are never uploaded.

---

## `bunny sites create`; Provision a site

```bash
bunny sites create                         # prompts for a name (directory-name suggestion), then a custom domain
bunny sites create my-site
bunny sites create my-site --region NY
bunny sites create my-site --domain example.com
bunny sites create my-site --no-link       # don't write .bunny/site.json
```

| Flag       | Description                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `--region` | Main storage region code (default `DE`)                                                                          |
| `--domain` | Attach a custom domain (+ `*.preview.<domain>`) after provisioning; interactive runs prompt for one when omitted |
| `--link`   | Link this directory (default true; `--no-link` to skip)                                                          |

Site names are 3-47 lowercase letters, digits, and dashes. The storage zone, pull zone, and b-cdn.net subdomain become `sites-<name>-xxxxxx` (a `sites-` prefix marking them in the dashboard, plus a shared random suffix since zone names are global across bunny.net); commands still take the clean site name. Creation is idempotent; a failed create re-runs cleanly, reusing whatever was already provisioned.

---

## `bunny sites deploy`; Deploy a directory

```bash
bunny sites deploy ./dist                  # preview only
bunny sites deploy ./dist --production     # publish as the live site (--prod works too)
bunny sites deploy --build                 # run `sites.build` from bunny.jsonc first
bunny sites deploy ./out --build "npm run build" --env VITE_FLAG=1
```

| Flag           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `[dir]`        | Directory to deploy (default: `sites.dir` in bunny.jsonc, then cwd)  |
| `--build`      | Run a build first (bare flag: `sites.build`, else a detected build)  |
| `--env`        | Build-time env override `KEY=VALUE` (repeatable; requires `--build`) |
| `--env-file`   | Dotenv file of build-time overrides (requires `--build`)             |
| `--production` | Publish as the live site (alias `--prod`; default is preview only)   |
| `--force`      | Deploy even when content is unchanged                                |
| `--site`       | Target site (name or storage zone ID)                                |

With `--build`, the build runs in your shell environment plus the `--env`/`--env-file` overrides; there is no remote env store; put build-time values in your local `.env` or CI secrets. Deploying already-uploaded content with `--production` skips the upload and just publishes it.

Interactive `deploy` adds two conveniences (both skipped under `--output json`):

- **No linked site** → it offers to create a new site or pick an existing one, then links it (goes straight to create when the account has no sites).
- **No `--build`** → it offers to run a build first: the configured `sites.build`, else a detected framework build (same detection as `ci init`), else a `package.json` `build` script. Confirming builds first, and when no `[dir]` was given it deploys the framework's output directory.

---

## `bunny sites deployments`; List, publish, prune

```bash
bunny sites deployments list
bunny sites deployments publish a1b2c3d4    # confirm prompt; --force to skip
bunny sites deployments publish --previous  # instant rollback
bunny sites deployments prune --keep 10     # never prunes current/previous
```

`publish` (alias `promote`) flips production to a past deploy; the files are already on the CDN, so this is instant plus a cache purge.

---

## `bunny sites domains`; Custom domains

```bash
bunny sites domains add example.com --wait  # wait for DNS, then issue SSL
bunny sites domains ssl example.com         # issue a certificate later
bunny sites domains list
bunny sites domains remove example.com
```

Adding a domain also attaches `*.preview.<domain>` for per-deploy preview URLs (removing it takes the wildcard down too). If the domain is on a Bunny DNS zone in the account, the CLI offers to create the records; otherwise it prints the CNAME target. The wildcard certificate may need DNS in place before it can issue; re-run `bunny sites domains ssl "*.preview.<domain>"` once DNS is live.

---

## `bunny sites ci init`; GitHub Actions deployments

```bash
bunny sites ci init                         # detect the framework, write .github/workflows/bunny-sites.yml
bunny sites ci init --framework astro       # skip detection (astro, vite, react-router, next, sveltekit, vitepress, docusaurus, eleventy, jekyll, hugo, static)
bunny sites ci init --site my-site --force  # overwrite an existing workflow
```

Writes a workflow that deploys previews on pull requests and publishes to production on merges to `main`, using the `BunnyWay/actions/deploy-site` action with the site name baked in. Framework detection reads `package.json` dependencies, `Gemfile`, or Hugo config; the lockfile picks the package manager for the install steps. Fork PRs are skipped (no secrets there). After writing, the CLI offers to run `gh secret set BUNNY_API_KEY` (or prints the manual steps). `sites create` offers the same scaffold on GitHub repos; declining prints the workflow instead.

---

## `bunny sites` lifecycle and maintenance

```bash
bunny sites list
bunny sites show                            # resources, domains, current deploy
bunny sites open                            # open the live URL in the browser (--print emits it)
bunny sites ssl --no-force-ssl              # toggle Force HTTPS on the site's b-cdn.net system host
bunny sites link my-site                    # .bunny/site.json
bunny sites unlink
bunny sites upgrade-router                  # republish the router with the CLI's current source
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

- Pass `--force` on anything with a confirmation (publish, prune, remove, delete); without a TTY they error with a hint rather than waiting on a prompt.
- Pass the site explicitly (or commit `bunny.jsonc` with `sites.name`); the interactive picker is disabled under `--output json` and by `--force`, so `sites delete --force` with nothing linked errors instead of prompting.
- `--output json` on every command emits machine-readable results (deploy prints `{ id, production, preview, promoted }`).
