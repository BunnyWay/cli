# deploy-site action: implementation plan (hand to an agent)

Build a new `deploy-site` action in the https://github.com/BunnyWay/actions repository. It wraps the `@bunny.net/cli` `sites deploy` command so a workflow can deploy a static site to bunny.net with one `uses:` step, and it owns the PR preview comment. This plan is self-contained; the companion design doc is `docs/plans/sites-github.md` in the CLI repo.

## What it must do

- Run `sites deploy` against a built directory: preview by default, production when asked.
- Parse the CLI's JSON output into action outputs.
- On `pull_request` events, upsert one sticky comment on the PR with the preview URL, updated per commit.
- Never reimplement deploy logic against the bunny API: the CLI is the single deploy path.

## Target repo conventions (observed, follow them)

- pnpm workspace monorepo; one folder per action (`deploy-script/`, `container-update-image/`).
- node20 JavaScript actions written in TypeScript under `<action>/src/`, bundled with ncc into `<action>/.lib-action/index.js`; `action.yml` points `runs.main` there.
- jest for tests, eslint config per action, `README.md` + `CHANGELOG.md` per action.
- Versioning via changesets (`pnpm changeset`); releases tag both `deploy-script@0.5.0` and `deploy-script_0.5.0` styles. The underscore tag is what `uses:` references should use (no double `@`).
- Branding block in `action.yml` (orange, an icon).

Start by copying the `deploy-script/` folder layout and its build/test wiring.

## action.yml

```yaml
name: Deploy Site to Bunny
author: Bunny Devs
description: Deploy a static site to bunny.net with preview URLs per deploy.

inputs:
  site:
    description: Site name or storage zone ID.
    required: true
  directory:
    description: Built output directory to deploy (e.g. dist).
    required: true
  api_key:
    description: bunny.net API key (store it as a repository secret).
    required: true
  production:
    description: Publish this deploy as the live site ("true"/"false", default preview only).
    required: false
    default: "false"
  comment:
    description: Upsert a sticky PR comment with the preview URL on pull_request events.
    required: false
    default: "true"
  github_token:
    description: Token for the PR comment (needs pull-requests write).
    required: false
    default: ${{ github.token }}
  cli_version:
    description: "@bunny.net/cli version range to run (pin bumped per action release)."
    required: false
    default: "0.10"
  force:
    description: Redeploy even when content is unchanged.
    required: false
    default: "false"

outputs:
  deploy-id:
    description: The deploy ID (git short sha on clean checkouts).
  preview-url:
    description: Preview URL for this deploy (empty when the site has no host yet).
  production-url:
    description: Production URL (set when production input was true).
  unchanged:
    description: '"true" when the content was already deployed and nothing ran.'

runs:
  using: "node20"
  main: ".lib-action/index.js"

branding:
  color: "orange"
  icon: "upload-cloud"
```

## The CLI contract

Invocation (spawn, do not shell-interpolate user input):

```
npx --yes @bunny.net/cli@<cli_version> sites deploy <directory> --site <site> [--production] [--force] --output json
```

- Env: pass through `process.env` plus `BUNNY_API_KEY` from the `api_key` input. Call `core.setSecret(apiKey)` first.
- The published CLI ships per-platform compiled binaries behind a Node launcher, so `npx` works on GitHub runners without installing Bun. Primary target is `ubuntu-latest`; macOS works; verify Windows binary availability before claiming support in the README (document ubuntu/macos only if not).
- JSON goes to stdout; human/progress output and errors go to stderr. Parse stdout only. Non-zero exit means the deploy failed: fail the action with the stderr tail.
- Output shapes (both must be handled):
  - Deployed: `{ "site": string, "id": string, "source": "git"|"content", "files": number, "bytes": number, "promoted": boolean, "production": string|null, "preview": string|null }`
  - No-op (content already deployed): `{ "site": string, "id": string, "unchanged": true, "live": boolean, "production": string|null, "preview": string|null }`
- `production`/`preview` are full URLs or null. Map null to empty-string outputs.

## Main logic (src/main.ts)

1. Read and validate inputs (`site`, `directory` non-empty; `directory` must exist: fail early with a clear message).
2. `core.setSecret(api_key)`; spawn the CLI via `@actions/exec` with `listeners.stdout`/`stderr` capture and `env: { ...process.env, BUNNY_API_KEY: apiKey }`.
3. On non-zero exit: `core.setFailed` with the last ~20 lines of stderr; do not attempt the comment.
4. Parse stdout JSON (tolerate leading noise by taking the substring from the first `{`; the CLI keeps stdout clean, this is belt and braces). Set the four outputs; also write a job summary line via `core.summary` (nice, cheap).
5. Comment step, only when all of: `comment` input is true, `context.eventName === "pull_request"`, and a preview URL exists.
   - Marker: `<!-- bunny-sites:<site> -->` as the first line of the comment body. This exact format matters: the CLI repo's future GitHub App takes over the same marker.
   - Upsert: `octokit.paginate(rest.issues.listComments, { issue_number })`, find a comment whose body starts with the marker, then `updateComment` or `createComment`.
   - Body:

     ```
     <!-- bunny-sites:my-site -->
     **bunny.net** deployed a preview of `my-site`

     | Deploy | Preview | Updated |
     | ------ | ------- | ------- |
     | `a1b2c3d4` | https://dpl-a1b2c3d4.preview.example.com | 2026-07-13 14:02 UTC |
     ```

   - Comment failures are `core.warning`, never a job failure (the deploy already succeeded).

6. No GitHub Deployments API calls in this version (that is the planned V2; leave the module boundary so it can slot in).

## Tests (jest, mirror deploy-script's setup)

- JSON parsing: both output shapes, null URLs, garbage stdout fails cleanly.
- Exec wiring: mocked `@actions/exec` asserts argv (`--production` only when input true, `--force` only when true) and that `BUNNY_API_KEY` is in the env.
- Comment upsert: mocked octokit asserts create-when-absent, update-when-marker-found, and skip on non-PR events / `comment: false` / missing preview URL.
- Failure path: non-zero exit sets failed and skips the comment.

## README.md for the action

Include: the minimal example below, the input/output tables, the fork-PR note, and the secret setup (`gh secret set BUNNY_API_KEY`).

```yaml
name: Deploy site
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: bunny-sites-${{ github.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - uses: BunnyWay/actions/deploy-site@deploy-site_1.0.0
        with:
          site: my-site
          directory: dist
          production: ${{ github.event_name == 'push' }}
          api_key: ${{ secrets.BUNNY_API_KEY }}
```

Also link to the CLI repo's framework examples and mention `bunny sites ci init` scaffolds this file.

## Release + ordering

1. Land the action with a changeset; release as `deploy-site@1.0.0` / tag `deploy-site_1.0.0` via the repo's existing release process.
2. Update the repo root README's action list.
3. Ordering with the CLI: the CLI's `sites ci init` scaffolds workflows referencing `BunnyWay/actions/deploy-site@deploy-site_1.0.0` (constant `DEPLOY_SITE_ACTION` in `packages/cli/src/commands/sites/ci/workflow.ts`). Publish the action before (or together with) the CLI release that ships `sites ci init`, and keep the `cli_version` default pinned to the CLI minor that includes `bunny sites` (0.10 at time of writing; bump on later releases).

## Guardrails

- Never log the API key; `core.setSecret` before any exec.
- Spawn with an argv array (no shell), inputs never string-concatenated into a command line.
- The action must work when the PR has no custom domain (path-based preview URL) and when the site has no hostname at all (preview null: skip the comment, still set outputs).
- Keep the action deploy-only: no purge/publish/rollback inputs in 1.0 (open question in the design doc).
