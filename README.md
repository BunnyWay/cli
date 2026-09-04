# @bunny.net/monorepo

Monorepo for the [bunny.net](https://bunny.net) CLI and supporting packages.

## Packages

| Package                                                            | Name                              | Description                                                                         |
| ------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| [`packages/cli/`](packages/cli/)                                   | `@bunny.net/cli`                  | Command-line interface for bunny.net                                                |
| [`packages/openapi-client/`](packages/openapi-client/)             | `@bunny.net/openapi-client`       | Standalone, type-safe OpenAPI client for bunny.net                                  |
| [`packages/sandbox/`](packages/sandbox/)                           | `@bunny.net/sandbox`              | Standalone sandbox SDK over Magic Containers and SSH                                |
| [`packages/config/`](packages/config/)                             | `@bunny.net/config`               | Shared Zod schemas, types, and JSON Schema for `bunny.jsonc` (app + sites)          |
| [`packages/database-client/`](packages/database-client/)           | `@bunny.net/database-client`      | Standalone `fetch`-only SQL client for server-side code (Edge Scripting, Bun, Node) |
| [`packages/database-shell/`](packages/database-shell/)             | `@bunny.net/database-shell`       | Standalone interactive SQL shell for Bunny Database                                 |
| [`packages/database-openapi/`](packages/database-openapi/)         | `@bunny.net/database-openapi`     | Generate OpenAPI 3.0 specs from a database schema                                   |
| [`packages/database-rest/`](packages/database-rest/)               | `@bunny.net/database-rest`        | PostgREST-like REST API handler (database-agnostic)                                 |
| [`packages/database-adapter/`](packages/database-adapter/)         | `@bunny.net/database-adapter`     | Bunny Database adapter for database-rest                                            |
| [`packages/scriptable-dns-types/`](packages/scriptable-dns-types/) | `@bunny.net/scriptable-dns-types` | Ambient TypeScript types for the Scriptable DNS runtime                             |

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
bun ny login                                # offers to install the agent skill after authenticating; --install-skill/--no-install-skill decides without prompting
bun ny db list
bun ny db migrations create add_users    # write migrations/0001_add_users.sql (numeric prefix = apply order)
bun ny db migrations list                # show applied / pending / changed migrations
bun ny db migrations apply               # apply pending migrations in order (--dry-run to preview, --dir drizzle for flat drizzle-kit output)
bun ny db migrations apply --pattern "*/migration.sql" # nested ORM layout; paths are tracked relative to migrations/
bun ny skills install                       # install the bunny agent skill into this project (AGENTS.md block + .agents/skills, plus .claude/skills when Claude Code is used) so AI coding tools know how to use the CLI; alias: skills update
bun ny skills install --global              # install to ~/.agents/skills and ~/.claude/skills for every project
bun ny skills remove                        # remove the skill from this project (or --global); everything is regenerable with skills install
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
bun ny storage regions                      # list every storage region, showing whether each can be a zone's main region, a replication target, or both
bun ny storage regions --tier ssd           # scope the list to one zone shape; the available set depends on both --tier hdd|ssd and --s3
bun ny storage zones add my-zone --tier ssd --s3   # create an Edge (SSD) zone (always Frankfurt) with S3-compatible access
bun ny storage files list                   # list files in the linked storage zone
bun ny storage files remove /               # empty the zone; asks twice (yes/no, then type the zone name), and unattended runs need --force
bun ny sites create my-site                 # provision a static site (storage zone + pull zone with edge rules; zones are named sites-my-site-<suffix>, served at sites-my-site-<suffix>.b-cdn.net)
bun ny sites create my-site --tier ssd      # provision a site whose files live on the Edge (SSD) storage tier (always DE)
bun ny sites deploy                         # no linked site? offers to create one or pick an existing; detects the framework, offers to build, then deploys (a site's first deploy also offers to attach a custom domain)
bun ny sites deploy ./dist                  # deploy a directory and publish it as the live site
bun ny sites deploy --build                 # run `sites.build` from bunny.jsonc (else the detected framework's build), then deploy `sites.dir` (or the detected output dir)
bun ny sites deploy ./catalog --deploy-id 20260827-1433-r42   # identify the deploy with your own release ID instead of the git sha / content hash
bun ny sites deployments list               # list deploys with the live one marked
bun ny sites deployments publish --previous # instant rollback to the previous deploy
bun ny sites deployments prune              # delete old deploys (keeps the newest 5, never current/previous)
bun ny sites deployments delete a1b2c3d4    # delete one deploy (never current/previous)
bun ny sites domains add example.com        # attach a custom production domain
bun ny sites ssl --no-force-ssl             # stop forcing HTTPS on the site's b-cdn.net system host
bun ny sites open                           # open the site's live URL in the browser
bun ny sites ci init                        # add a GitHub Actions workflow (push to main goes live)
bun ny stream library list                # list Stream video libraries (videos, storage, traffic, replication regions)
bun ny stream library create my-library   # create a video library (omit the name to be prompted; --name also works)
bun ny stream library create my-library --replication-regions NY,SG   # replicate the library's storage to New York and Singapore
bun ny stream library show my-library     # show one library (accepts a name or ID; omit it to use the linked library, or to pick interactively when nothing is linked). API keys are never printed here, in any output format
bun ny stream library update my-library --resolutions 720p,1080p   # edit library settings; omit the flags to edit interactively (encoding tier, codecs, transcribing all have flags)
bun ny stream library credentials my-library --show-secret   # deliberately retrieve a library's Stream API key (--read-only for the read-only key; masked without --show-secret)
bun ny stream library delete my-library   # delete a library and all of its videos (--force skips the confirmation, and is required non-interactively)
bun ny stream library link my-library     # link the directory to a library so video commands can omit it (bun ny stream library unlink removes the link)
bun ny stream video upload ./video.mp4    # upload a local video to the linked library (--title sets the title; files over 2 GB upload resumably via TUS, retried and resumed automatically)
bun ny stream video fetch https://example.com/video.mp4 --lib 12345   # let bunny.net fetch the video server side (--header "Name: value" for an origin that needs auth)
bun ny stream video list                  # list the videos in the linked library (ID, title, status, size, length, views, upload date)
bun ny stream video show 1a2b3c4d-...     # show one video by GUID, including its Direct Play URL
bun ny stream video thumbnail 1a2b3c4d-... --file ./thumb.jpg   # set a thumbnail (--url has bunny.net download one instead)
bun ny stream video stats 1a2b3c4d-...    # views and watch time for one video (--heatmap, --play-data for the other views)
bun ny stream video cleanup 1a2b3c4d-... --non-configured --dry-run   # preview deleting renditions the library no longer configures
bun ny stream collection list             # list a library's collections (create/show/rename/delete too; videos join one with --collection)
bun ny stream caption add 1a2b3c4d-... en --file ./captions.vtt   # upload your own caption file for one language
bun ny stream transcribe 1a2b3c4d-... --languages en,de   # paid: transcribe the audio into captions ($0.10 per language-minute)
bun ny stream smart 1a2b3c4d-... --title --chapters   # paid: generate a title and chapters from the transcript (asks first if the video has no captions yet)
```

Every deploy is published as the live site. Deploys are immutable under their own ID, so `bun ny sites deployments publish` rolls back to any earlier one without re-uploading. Preconfigure the `sites` block in `bunny.jsonc` (`name`, `build`, `dir`) so a deploy needs no flags: `bun ny sites deploy --build`. `bun ny sites ci init` writes the same `build` and `dir` into the generated workflow. See [`examples/sites/`](examples/sites/) for ready-to-copy configs (Vite, Astro, Next.js static export, Hugo, plain HTML, and a combined app + site file).

### Available scripts

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
