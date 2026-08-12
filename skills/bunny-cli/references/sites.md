# Static Sites Commands

All site commands live under `bunny sites`. A site is one storage zone (files) + one pull zone (CDN) + one middleware router script, provisioned together by `sites create`. Deploys are immutable directories; promoting or rolling back flips a router env var and purges the cache; no files move, so it's instant.

Most commands accept an optional site (a trailing `[site]` positional, or the `--site` flag on commands whose positionals are taken, like `deploy`). When omitted, the site resolves in this order:

1. Explicit name or storage zone ID
2. `.bunny/site.json` manifest (written by `bunny sites link` or `bunny sites create`)
3. `sites.name` in `bunny.jsonc`
4. Interactive prompt (suppressed in `--output json` mode, and on destructive commands run with `--force`; pass a site or link the directory in CI)

Commands that can link the directory (`deploy`, `show`, `deployments list/publish`, `upgrade-router`, `ci init`) take `--link`/`--no-link`: the picker prompts unless the flag decided it, and an explicit `--link` also links a site resolved from a ref or from `bunny.jsonc`, including under `--output json`. The other site commands never write the manifest and don't take the flag.

## Typical workflows

```bash
# New site: provision, deploy, iterate
bunny sites create my-site                 # served at https://sites-my-site-<suffix>.b-cdn.net
bunny sites deploy ./dist                  # immutable preview URL; the interactive first deploy offers to publish

# Build-and-deploy in one step (build command from bunny.jsonc or the flag)
bunny sites deploy --build                 # runs `sites.build`, deploys `sites.dir`
bunny sites deploy ./out --build "npm run build"

# Rollback
bunny sites deployments list               # find the deploy ID (● Live marks production)
bunny sites deployments publish --previous --force   # instant rollback
bunny sites deployments publish a1b2c3d4 --force     # promote a specific deploy

# Custom production domain (optional; previews never need one)
bunny sites domains add example.com --wait # production vanity hostname + SSL
bunny sites deploy ./dist --production     # publish live: https://example.com
```

## Every deploy gets its own preview URL

This is the rule that shapes every other command here:

- Every `deploy` serves at an immutable preview URL, `https://sites-dpl-<id>-<suffix>.b-cdn.net`: the deploy's own pull zone, HTTPS out of the box, no custom domain or DNS setup.
- Publishing is always explicit: `--production`/`--prod` (a fresh site's interactive first deploy offers it, since nothing is live yet).
- Custom domains are production-only vanity hostnames; they change nothing about previews.

Previews are root-served on their own host, not under a path prefix, so client-side routers (TanStack Router, React Router, Vue Router in history mode) and root-absolute assets behave exactly as they do in production. Preview responses carry `X-Robots-Tag: noindex`. Deploys are not otherwise addressable: `/deploys/<id>/` URLs are internal to the storage layout and are not publicly served. Preview URLs live as long as their deploy: `deployments prune` deletes old deploys together with their preview zones.

## Deploy IDs

- The deploy ID is the **git short-sha** when the working tree is clean, otherwise an 8-char **content hash**. Re-deploying identical content is a no-op (`--force` overrides).
- Dotfiles and `node_modules` are never uploaded.

---

## `bunny sites create`; Provision a site

```bash
bunny sites create                         # uses `sites.name` from bunny.jsonc, else prompts (directory-name suggestion), then a custom domain
bunny sites create my-site
bunny sites create my-site --region NY
bunny sites create my-site --domain example.com
bunny sites create my-site --no-link       # don't write .bunny/site.json
```

| Flag       | Description                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `--region` | Main storage region code (default `DE`)                                                            |
| `--domain` | Attach a custom production domain after provisioning; interactive runs prompt for one when omitted |
| `--link`   | Link this directory (default true; `--no-link` to skip)                                            |

Site names are 3-47 lowercase letters, digits, and dashes. The storage zone, pull zone, and b-cdn.net subdomain become `sites-<name>-xxxxxx` (a `sites-` prefix marking them in the dashboard, plus a shared random suffix since zone names are global across bunny.net); commands still take the clean site name. Creation is idempotent; a failed create re-runs cleanly, reusing whatever was already provisioned.

---

## `bunny sites deploy`; Deploy a directory

```bash
bunny sites deploy ./dist                  # deploy to an immutable preview URL
bunny sites deploy ./dist --production     # publish as the live site (--prod works too)
bunny sites deploy --build                 # run `sites.build` from bunny.jsonc first
bunny sites deploy ./out --build "npm run build" --env VITE_FLAG=1
```

| Flag           | Description                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `[dir]`        | Directory to deploy (default: `sites.dir` in bunny.jsonc, then cwd)                                                    |
| `--build`      | Run a build first (bare flag: `sites.build`, else a detected build)                                                    |
| `--env`        | Build-time env override `KEY=VALUE` (repeatable; requires `--build`)                                                   |
| `--env-file`   | Dotenv file of build-time overrides (requires `--build`)                                                               |
| `--production` | Publish as the live site (alias `--prod`); the default is a preview, and an interactive first deploy offers to publish |
| `--force`      | Deploy even when content is unchanged                                                                                  |
| `--site`       | Target site (name or storage zone ID)                                                                                  |
| `--link`       | Link this directory to the deployed site (`--no-link` never links)                                                     |

With `--build`, the build runs in your shell environment plus the `--env`/`--env-file` overrides; there is no remote env store; put build-time values in your local `.env` or CI secrets. Deploying already-uploaded content with `--production` skips the upload and just publishes it.

Interactive `deploy` adds three conveniences (all skipped under `--output json`):

- **No linked site** → it offers to create a new site or pick an existing one, then links it (goes straight to create when the account has no sites).
- **No `--build`** → it offers to run a build first: the configured `sites.build`, else a detected framework build (same detection as `ci init`), else a `package.json` `build` script. Confirming builds first, and when no `[dir]` was given it deploys the framework's output directory.
- **A site with no production deploy yet** → it offers to publish this deploy to production (a preview URL is created either way). A domainless site's first deploy also offers to attach a custom production domain (blank skips) and runs the same DNS/SSL flow as `sites domains add`; it asks only once per site, and every later domainless deploy just prints a one-line `sites domains add` hint.

---

## `bunny sites deployments`; List, publish, prune

```bash
bunny sites deployments list
bunny sites deployments publish a1b2c3d4    # confirm prompt; --force to skip
bunny sites deployments publish --previous  # instant rollback
bunny sites deployments prune --keep 10     # never prunes current/previous
bunny sites deployments prune my-site       # or --site my-site
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

A custom domain is the site's production URL and nothing more; previews run on their own b-cdn.net zones and don't depend on it. The first added domain is recorded as the production URL. If the domain is on a Bunny DNS zone in the account, the CLI offers to create the record; otherwise it prints the CNAME target. The CLI verifies a certificate actually landed on the exact hostname before forcing HTTPS or reporting success, and probes the domain over TLS afterwards, so a mismatched certificate (e.g. shadowed by another zone's wildcard) warns instead of printing a broken URL. Re-running `bunny sites domains add <domain>` after a partial setup reconciles the remaining steps instead of failing on the already-attached hostname.

---

## `bunny sites ci init`; GitHub Actions deployments

```bash
bunny sites ci init                         # detect the framework, write .github/workflows/bunny-sites.yml
bunny sites ci init --framework astro       # skip detection (astro, vite, react-router, next, sveltekit, vitepress, docusaurus, eleventy, jekyll, hugo, static)
bunny sites ci init --site my-site --force  # overwrite an existing workflow
```

Writes a workflow using the `BunnyWay/actions/deploy-site` action with the site name baked in: previews on pull requests, production on merges to `main` (previews need no custom domain, so there is a single workflow shape). `sites.dir` and `sites.build` from `bunny.jsonc` override the preset's deploy directory and build command, so CI builds and deploys exactly what a local `sites deploy` does. The workflow is written at the git root; when `bunny.jsonc` lives below it (a monorepo package), the job gets `defaults.run.working-directory` and the deploy directory is prefixed, so those paths still mean what they do locally. Framework detection reads `package.json` dependencies, `Gemfile`, or Hugo config; the lockfile picks the package manager for the install steps. Fork PRs are skipped (no secrets there). After writing, the CLI offers to run `gh secret set BUNNY_API_KEY` (or prints the manual steps). `sites create` offers the same scaffold on GitHub repos; declining prints the workflow instead.

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
- `--output json` on every command emits machine-readable results. `deploy` prints `{ id, production, preview, promoted }`, where `preview` is `null` and `promoted` is `true` on a site with no custom domain; use `promoted` rather than assuming `--production` decided it.
- The first-deploy custom-domain prompt never runs under `--output json` or without a TTY, so CI deploys are unaffected.
