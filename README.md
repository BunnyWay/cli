# @bunny.net/monorepo

Monorepo for the [bunny.net](https://bunny.net) CLI and supporting packages.

## Packages

| Package                                                                  | Name                                 | Description                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------- |
| [`packages/cli/`](packages/cli/)                                         | `@bunny.net/cli`                     | Command-line interface for bunny.net                                                |
| [`packages/openapi-client/`](packages/openapi-client/)                   | `@bunny.net/openapi-client`          | Standalone, type-safe OpenAPI client for bunny.net                                  |
| [`packages/sandbox/`](packages/sandbox/)                                 | `@bunny.net/sandbox`                 | Standalone sandbox SDK over Magic Containers and SSH                                |
| [`packages/config/`](packages/config/)                                   | `@bunny.net/config`                  | Shared Zod schemas, types, and JSON Schema for `bunny.jsonc` (app + sites)          |
| [`packages/database-client/`](packages/database-client/)                 | `@bunny.net/database-client`         | Standalone `fetch`-only SQL client for server-side code (Edge Scripting, Bun, Node) |
| [`packages/database-shell/`](packages/database-shell/)                   | `@bunny.net/database-shell`          | Standalone interactive SQL shell for libSQL databases                               |
| [`packages/database-openapi/`](packages/database-openapi/)               | `@bunny.net/database-openapi`        | Generate OpenAPI 3.0 specs from a database schema                                   |
| [`packages/database-rest/`](packages/database-rest/)                     | `@bunny.net/database-rest`           | PostgREST-like REST API handler (database-agnostic)                                 |
| [`packages/database-adapter-libsql/`](packages/database-adapter-libsql/) | `@bunny.net/database-adapter-libsql` | Bunny Database adapter for database-rest                                            |
| [`packages/scriptable-dns-types/`](packages/scriptable-dns-types/)       | `@bunny.net/scriptable-dns-types`    | Ambient TypeScript types for the Scriptable DNS runtime                             |

See each package's README for usage and API documentation.

## Installation

```bash
# Shell installer (downloads prebuilt binary)
curl -fsSL https://cli.bunny.net/install.sh | sh

# Or via npm
npm install -g @bunny.net/cli

# Or via bun
bun install -g @bunny.net/cli
```

## Development

```bash
# Install dependencies
bun install

# Run the CLI locally
bun ny <command>

# Examples
bun ny login
bun ny db list
bun ny apps deploy ghcr.io/me/api:v1.2     # deploy a pre-built image
bun ny apps deploy --dockerfile             # build ./Dockerfile and deploy
bun ny apps deploy                          # first run? Imports docker-compose.yml if present; otherwise auto-detects Dockerfile(s) (including monorepo subdirs) so you can pick one or many, or falls back to a pre-built image.
bun ny apps link                            # interactive: pick from existing apps on the account
bun ny apps link <app-id>                   # link a specific app to this directory (writes .bunny/app.json)
bun ny apps unlink                          # remove .bunny/app.json
bun ny sandbox create my-sandbox            # create an ephemeral dev sandbox (backed by a Magic Containers app)
bun ny dns zones add example.com            # create a zone, then choose how to add records (scan existing / upload a BIND zone file / add manually) before registrar setup steps
bun ny dns zones nameservers example.com    # live-check whether the registrar delegates to bunny
bun ny dns records scan example.com         # scan for the domain's existing records and import them
bun ny dns records preset list              # list DNS record presets (email providers, verification, security)
bun ny dns records preset google-workspace example.com   # apply a preset record set
bun ny dns records preset bluesky example.com --param did=did:plc:abc123   # apply a preset non-interactively
bun ny sites create my-site                 # provision a static site (storage zone + pull zone + edge router; zones are named sites-my-site-<suffix>, served at sites-my-site-<suffix>.b-cdn.net)
bun ny sites deploy                         # no linked site? offers to create one or pick an existing; detects the framework, offers to build, then deploys (a site's first deploy also offers a custom domain)
bun ny sites deploy ./dist                  # deploy the site: goes live directly, or to an immutable preview URL (dpl-<id>.preview.<domain>) once a custom domain is attached
bun ny sites deploy ./dist --production     # publish as the live site when a custom domain gives you previews (--prod works too)
bun ny sites deploy --build                 # run `sites.build` from bunny.jsonc (else the detected framework's build), then deploy `sites.dir` (or the detected output dir)
bun ny sites deployments list               # list deploys with the live one marked
bun ny sites deployments publish --previous # instant rollback to the previous deploy
bun ny sites deployments prune              # delete old deploys (keeps the newest 5, never current/previous)
bun ny sites domains add example.com        # attach a custom domain (+ *.preview.example.com, which unlocks per-deploy preview URLs)
bun ny sites ssl --no-force-ssl             # stop forcing HTTPS on the site's b-cdn.net system host
bun ny sites open                           # open the site's live URL in the browser
bun ny sites ci init                        # add a GitHub Actions workflow (with a custom domain: previews on PRs + production on main; without: production on main)
```

Preconfigure the `sites` block in `bunny.jsonc` (`name`, `build`, `dir`) so a deploy needs no flags: `bun ny sites deploy --build --prod`. `bun ny sites ci init` writes the same `build` and `dir` into the generated workflow. See [`examples/sites/`](examples/sites/) for ready-to-copy configs (Vite, Astro, Next.js static export, Hugo, plain HTML, and a combined app + site file).

### Available Scripts

```bash
# Type check the entire monorepo
bun run typecheck

# Run tests
bun test

# Build standalone executable
bun run build

# Update OpenAPI specs and regenerate types
bun run openapi:update

# Regenerate types from existing specs
bun run openapi:generate
```

### Changesets

This monorepo uses [changesets](https://github.com/changesets/changesets) for versioning and changelogs.

```bash
# Add a changeset (interactive prompt)
bun run changeset

# Apply changesets and bump versions
bun run version

# Publish all packages
bun run release
```

### Making the CLI available globally

```bash
bun link
bunny <command>
```
