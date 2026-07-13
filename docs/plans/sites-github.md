# Sites + GitHub: preview deploys on PRs, production on main (plan)

Status: V1 CLI side (scaffolder, framework detection, state-merge hardening) is implemented on the sites branch; the action itself is planned in `docs/plans/deploy-site-action.md`. Companion to `docs/plans/sites.md`.

## Goal

- Open a PR (or push a new commit to one): the site is built and deployed to a preview URL.
- Merge to `main`: the site is built, deployed, and published as the live site.
- The PR gets a comment with the preview URL, updated per commit.
- No bespoke "deployments API" for the workflow to call, and no bunny-hosted service in V1. The workflow builds and runs the CLI; the CLI talks to the same storage/core/compute APIs it uses today.

## V1: a `deploy-site` action + example workflows per framework, nothing hosted

V1 has two deliverables and no hosted pieces:

1. **`BunnyWay/actions/deploy-site`**: a small action in the existing [BunnyWay/actions](https://github.com/BunnyWay/actions) repo that wraps `bunny sites deploy` and owns the PR comment.
2. **Per-framework example workflows** (Jekyll, Astro, React Router, ...) that are just "build, then use the action".

Everything the flow needs already exists in the CLI:

- Preview is the deploy default; `--production` publishes. That maps 1:1 onto `pull_request` vs `push` to `main`.
- Deploy IDs are git short shas on clean checkouts (CI is always clean), so each commit gets a stable preview URL.
- `deploy --output json` emits `{ id, production, preview, promoted, unchanged }`, which is the action's entire contract with the CLI.
- The site is named explicitly (`site` input / `--site` flag); nothing needs to be committed to the repo and the interactive picker never enters CI. (`bunny.jsonc` is experimental and deliberately not part of this flow.)
- The published CLI ships compiled per-platform binaries behind a Node launcher, so `npx @bunny.net/cli` works on any runner with Node, no Bun install needed. Jekyll/Hugo/Ruby workflows do not have to pull in a JS toolchain beyond that.

### The `deploy-site` action (BunnyWay/actions)

Fits the repo's existing conventions: one folder per action, node20 JS actions bundled with ncc, changesets for versioning, tags like `deploy-site@1.0.0`, used as `BunnyWay/actions/deploy-site@<ref>`.

The action is deliberately a thin shell around the CLI (single deploy path, nothing reimplemented against the API): it runs `npx @bunny.net/cli@<version> sites deploy <dir> --site <site> [--production] --output json`, parses the JSON, and handles the GitHub-side UX with `@actions/core`/`@actions/github`, which is where that logic naturally lives (the CLI stays platform-neutral).

```yaml
# action.yml sketch
inputs:
  site: # site name or storage zone ID (required)
  directory: # built output to deploy (required)
  production: # "true" publishes as the live site (default: false -> preview)
  api_key: # BUNNY_API_KEY (required; see deploy_key note below)
  comment: # upsert a sticky PR comment with the preview URL (default: true)
  github_token: # for the comment; defaults to github.token
  cli_version: # @bunny.net/cli version (default: latest major pin, e.g. "1")
  force: # redeploy unchanged content (default: false)
outputs:
  deploy-id:
  preview-url:
  production-url:
  unchanged:
```

Comment behavior: on `pull_request` events, upsert one sticky comment (marker `<!-- bunny-sites:<site> -->`) with the preview URL, deploy ID, and updated time. Posts as `github-actions[bot]` via the workflow token; needs `pull-requests: write`. `comment: false` opts out. Comment failures warn, never fail the deploy.

The `deploy-script` action there already accepts a `deploy_key` as a scoped alternative to the account `api_key`. Sites should aim for the same shape once a scoped deploy credential exists (see security notes); the input surface leaves room for it.

### The shared skeleton

Every framework example is this workflow with a different build block:

```yaml
# .github/workflows/bunny-sites.yml
name: Deploy site
on:
  push:
    branches: [main]
  pull_request:

# One deploy at a time per ref; a newer commit cancels the older build.
concurrency:
  group: bunny-sites-${{ github.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    # Fork PRs have no access to secrets; skip instead of failing.
    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
    permissions:
      contents: read
      pull-requests: write # preview comment
    steps:
      - uses: actions/checkout@v4

      # --- framework-specific setup + build (see matrix below) ---
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
      # -----------------------------------------------------------

      - uses: BunnyWay/actions/deploy-site@deploy-site_1.0.0
        with:
          site: my-site
          directory: ./dist
          production: ${{ github.event_name == 'push' }}
          api_key: ${{ secrets.BUNNY_API_KEY }}
```

Setup for a user: drop in the workflow file with their site name, `gh secret set BUNNY_API_KEY`, done.

The docs also show the raw-CLI variant (no action) for people who want full control: the same workflow with the deploy step as `npx @bunny.net/cli sites deploy ./dist --site my-site --output json` plus their own comment step. The action is convenience, not a requirement, and the JSON contract is documented either way.

### Framework matrix

Frameworks mostly collapse into a toolchain plus two values (build command, output dir). The published examples are concrete per framework because that is what people search for; internally they are one template over this table:

| Framework                                    | Setup steps                             | Build                      | Output dir        |
| -------------------------------------------- | --------------------------------------- | -------------------------- | ----------------- |
| Astro                                        | setup-bun or setup-node                 | `astro build`              | `dist`            |
| Vite (React, Vue, Svelte, ...)               | setup-bun or setup-node                 | `vite build`               | `dist`            |
| React Router (framework mode, SPA/prerender) | setup-bun or setup-node                 | `react-router build`       | `build/client`    |
| Next.js (`output: "export"`)                 | setup-node                              | `next build`               | `out`             |
| SvelteKit (`adapter-static`)                 | setup-bun or setup-node                 | `vite build`               | `build`           |
| Eleventy                                     | setup-node                              | `eleventy`                 | `_site`           |
| Docusaurus                                   | setup-node                              | `docusaurus build`         | `build`           |
| VitePress                                    | setup-node                              | `vitepress build`          | `.vitepress/dist` |
| Jekyll                                       | ruby/setup-ruby (`bundler-cache: true`) | `bundle exec jekyll build` | `_site`           |
| Hugo                                         | peaceiris/actions-hugo                  | `hugo --minify`            | `public`          |
| Plain HTML                                   | none                                    | none                       | `.` or `public`   |

Node examples use the repo's package manager (detect lockfile: bun/pnpm/yarn/npm) with the matching cache option on the setup action. Non-Node frameworks need no JS setup at all: the action's `npx` call only requires the runner's preinstalled Node.

### Where the examples live

1. `deploy-site/README.md` in BunnyWay/actions: the action's own docs with the skeleton (that is where `uses:` consumers land).
2. `skills/bunny-cli/references/sites.md` + this repo's README: the skeleton, the matrix, and the raw-CLI variant (the skill is what agents read).
3. A `docs/examples/github-workflows/` directory in this repo with one complete `.yml` per framework, linked from the README. Cheap to maintain because they differ only in the marked block.
4. Optionally the bunny.net docs site later; out of scope here.

### Scaffolder (CLI work, optional and independent)

- `sites create` (interactive, git repo with a GitHub `origin`): after the domain step, ask "Set up GitHub deployments (preview on PRs, production on main)?".
- Framework detection picks the template: `astro`/`@react-router/dev`/`next`/`vite`/`vitepress`/`@sveltejs/kit`/`@11ty/eleventy`/`@docusaurus/core` in `package.json` dependencies, `Gemfile` mentioning `jekyll`, `hugo.toml`/`config.toml` + `content/` for Hugo. Ambiguous or unknown: prompt with a select, defaulting to the plain skeleton with TODO placeholders.
- Writes `.github/workflows/bunny-sites.yml` (never overwrites without confirmation) with the site name, build block, and output dir baked in, using the `deploy-site` action. The site name comes from the site just created (`sites create`) or the resolved site (`sites ci init`); no config file involved.
- Declined, or non-interactive: print the YAML and the secret instructions instead, so nothing is gated on the prompt.
- Standalone `bunny sites ci init` for existing sites; same behavior.
- Ends with the one manual step: `gh secret set BUNNY_API_KEY` (offered as a prompted command when `gh` is installed, printed otherwise).

Ship order within V1 is flexible: action first, examples second, scaffolder third; each is independently useful.

### V1 security notes

- Fork PRs skip via the `if:` guard (no secrets there). Do NOT use `pull_request_target` to work around it: it runs untrusted build scripts with access to `BUNNY_API_KEY`.
- `BUNNY_API_KEY` is the account key, which is broad for a repo secret. Per-site deploy tokens are a worthwhile platform ask (precedent: `deploy-script`'s `deploy_key` input); not a blocker.
- Concurrent deploys: `concurrency` serializes per ref. Cross-PR races are safe for files (distinct `deploys/<id>/` prefixes) but the remote-state read-modify-write can drop a deploy record (v1 lock warns and overwrites). Hardening item before advertising CI: retry-with-merge on etag mismatch in `writeRemoteState`.
- `pull_request` checkouts are the synthetic merge commit, so the deploy ID is the merge sha, not the head sha. Fine: the URL flows through the action outputs, and the preview shows what main would look like post-merge.
- The action pins the CLI to a major version (`cli_version` input) so a bad CLI release cannot silently change deploy behavior for every consumer.

## V2: the action grows GitHub Deployments

The `deploy-site` action (not the CLI, which stays platform-neutral) additionally creates a GitHub Deployment for the SHA (`environment: preview|production`, `transient_environment` for previews) and marks its status `success` with `environment_url`. GitHub then shows "Deployed to preview" natively in the PR timeline and environment history on the repo. Needs `deployments: write` in the workflow permissions.

This is also the hand-off point for V3: deployments are the state channel the app subscribes to.

## V3: the GitHub App (identity upgrade only)

A public "bunny.net Deployments" app whose only job is reporting UX; deploys never depend on it:

- Permissions: `pull_requests: write`, `deployments: read`, `metadata: read` (optional `checks: write` later).
- Subscribes to `deployment_status` webhooks (the deployments V2 creates), looks up PRs for the SHA, and takes over the same marker comment as `bunny.net[bot]`. Stateless; the `environment_url` in the payload carries the URL.
- The receiver is GitHub-facing only (the action never calls it) and small enough to host as a bunny Edge Script: HMAC-verify `X-Hub-Signature-256`, exchange the app private key (RS256 JWT via WebCrypto) for an installation token, two REST calls, 200.
- An app cannot replace the build step without bunny running builds on untrusted code, which stays a non-goal.

## Open questions

1. Action naming and versioning in BunnyWay/actions: `deploy-site` vs `sites-deploy`; follow the existing `<action>@x.y.z` tag scheme.
2. Which frameworks make the initial examples cut (proposal: Astro, Vite, React Router, Next static export, Jekyll, Hugo, plain HTML; add the rest on demand).
3. Whether the action should also expose `purge`/`publish <id>` style operations later (rollback from a workflow), or stay deploy-only.
