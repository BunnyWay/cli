# AGENTS.md: bunny.net CLI

This document describes the architecture, conventions, and implementation details for the bunny.net CLI. It serves as the canonical reference for AI agents and contributors working on this codebase.

---

## Overview

The bunny.net CLI (`bunny`) is a command-line interface for interacting with bunny.net services (Magic Containers, Edge Scripting, databases). It is written in TypeScript, runs on the Bun runtime, and follows patterns inspired by Cobra (Go).

The CLI supports profile-based authentication, browser-based login, and a modular command structure built on `yargs`.

---

## Runtime & Tooling

| Concern             | Tool    | Notes                                                           |
| ------------------- | ------- | --------------------------------------------------------------- |
| Runtime             | **Bun** | Runs TypeScript natively. No transpilation step in development. |
| Package manager     | **Bun** | `bun add`, `bun install`. Lockfile is `bun.lock`.               |
| Test runner         | **Bun** | `bun test`. Jest-compatible API.                                |
| Build / compile     | **Bun** | `bun build --compile` produces a single native executable.      |
| Watch mode          | **Bun** | `bun --watch packages/cli/src/index.ts` for development.        |
| Env loading         | **Bun** | Auto-loads `.env` files. No `dotenv` package needed.            |
| Local HTTP servers  | **Bun** | `Bun.serve()` for the auth callback server. No Express needed.  |
| Subprocess spawning | **Bun** | `Bun.spawn()` for opening browsers, running child processes.    |

### Why Bun

Bun replaces the entire Node.js toolchain. There are no separate tools for transpilation (`ts-node`, `tsx`), bundling (`esbuild`, `webpack`), testing (`jest`, `vitest`), or executable packaging (`pkg`, `nexe`). The `tsconfig.json` exists only for editor type-checking (`tsc --noEmit`); Bun handles all execution and compilation.

---

## Dependencies

### Runtime dependencies

| Package          | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `yargs`          | Command routing, subcommands, flag parsing, auto-help          |
| `chalk`          | Terminal string styling (colors, bold, dim)                    |
| `ora`            | Terminal spinners for async operations                         |
| `prompts`        | Interactive input: password masks, confirmations, multi-select |
| `cli-table3`     | Formatted terminal tables                                      |
| `zod`            | Schema validation for config files and CLI input               |
| `@libsql/client` | libSQL database client (used by `db shell`)                    |
| `openapi-fetch`  | Type-safe HTTP client generated from OpenAPI specs             |
| `jsonc-parser`   | JSONC parser for `bunny.jsonc` config files                    |

### Dev dependencies

| Package              | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `@types/yargs`       | Type definitions for yargs                         |
| `@types/prompts`     | Type definitions for prompts                       |
| `typescript`         | Type-checking only (`tsc --noEmit`)                |
| `openapi-typescript` | Generates TypeScript types from OpenAPI JSON specs |

### Packages we explicitly do NOT use

- **No `dotenv`** — Bun loads `.env` automatically.
- **No `execa`** — Use `Bun.spawn()` or `Bun.$` shell.
- **No `express` or `http`** — Use `Bun.serve()` for HTTP servers.
- **No `ink` or `react`** — We use the lighter stack of `ora` + `prompts` + `chalk`.
- **No `commander` or `clipanion`** — We use `yargs`.
- **No `cosmiconfig`** — Config file resolution is hand-rolled to match the existing Go CLI behavior.

---

## Project Structure

This is a Bun workspace monorepo with six packages:

- **`@bunny.net/openapi-client`** (`packages/openapi-client/`) — Standalone, type-safe OpenAPI client for bunny.net, generated from OpenAPI specs. Zero CLI dependencies. Publishable to npm.
- **`@bunny.net/config`** (`packages/config/`) — Shared `bunny.jsonc` schemas (Zod), inferred types, JSON Schema generation, and API conversion functions. The root `BunnyConfigSchema` has optional `app` (Magic Containers) and `sites` (static sites) blocks; `BunnyAppConfigSchema` narrows it to require `app`. Used by the CLI and potentially other tools.
- **`@bunny.net/database-shell`** (`packages/database-shell/`) — Standalone interactive SQL shell for libSQL databases. Framework-agnostic REPL, dot-commands, formatting, masking, and history. Also usable as a standalone CLI (binary: `bsql`).
- **`@bunny.net/scriptable-dns-types`** (`packages/scriptable-dns-types/`): Ambient TypeScript declarations for the Scriptable DNS runtime globals (`ARecord`, `Monitoring`, `RoutingEngine`, etc.). Types-only, no runtime code: the DNS runtime can't `import`, so these power editor autocomplete and an optional typecheck step. Scaffolded into projects by `bunny dns scripts init`; intended to also feed the dashboard editor. Publishable to npm.
- **`@bunny.net/sandbox`** (`packages/sandbox/`) — Standalone sandbox SDK. Code-first DX (`Sandbox.create`, `writeFiles`, `runCommand`, `exposePort`, `setEnv`/`getEnv`/`unsetEnv`, `listFiles`/`deleteFile`/`rename`/`exists`) over Magic Containers provisioning plus an `ssh2` SSH/SFTP transport. Blocking `runCommand` accepts `timeout` (rejects with `CommandTimeoutError` carrying partial output), `signal` for cancellation, and `onStdout`/`onStderr` callbacks for live output. Env vars can be baked in at `create` (persisted), passed per-command via `runCommand({ env })` (temporary), or persisted after creation via `setEnv`. The handle implements `Symbol.dispose`/`Symbol.asyncDispose` so `using`/`await using` release the SSH connection (without deleting the sandbox). Zero CLI dependencies.
- **`@bunny.net/cli`** (`packages/cli/`) — The CLI. Depends on `@bunny.net/openapi-client`, `@bunny.net/config`, `@bunny.net/database-shell`, `@bunny.net/scriptable-dns-types`, and `@bunny.net/sandbox`.

```
bunny-cli/
├── packages/
│   ├── openapi-client/                   # @bunny.net/openapi-client package
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── redocly.yaml                  # Multi-spec config for openapi-typescript
│   │   ├── specs/                        # OpenAPI specs (committed, JSON)
│   │   │   ├── core.json                 # Core API — https://api.bunny.net
│   │   │   ├── compute.json              # Edge Scripting API — https://api.bunny.net/compute
│   │   │   ├── database.json             # Database API — https://api.bunny.net/database
│   │   │   ├── magic-containers.json     # Magic Containers API — https://api.bunny.net/mc
│   │   │   ├── origin-errors.json        # Origin Errors API — https://cdn-origin-logging.bunny.net
│   │   │   ├── shield.json               # Shield API — https://api.bunny.net (paths under /shield/...)
│   │   │   ├── storage.json              # Edge Storage API — https://storage.bunnycdn.com (region-specific)
│   │   │   └── stream.json               # Stream API — https://video.bunnycdn.com
│   │   ├── scripts/
│   │   │   └── update-specs.ts           # Downloads latest specs from bunny.net endpoints
│   │   └── src/
│   │       ├── index.ts                  # Barrel export: clients, authMiddleware, errors, ClientOptions type, DNS scan type corrections
│   │       ├── core.ts … stream.ts       # Per-API subpath entrypoints (core, compute, database, magic-containers, origin-errors, shield, storage, stream): each re-exports its client factory + generated spec types (backs the package.json "./<api>" exports)
│   │       ├── middleware.ts             # authMiddleware(options) — dependency-inverted (no CLI imports)
│   │       ├── errors.ts                 # UserError, ApiError classes
│   │       ├── dns.ts                    # Hand-authored corrections for lossy generated DNS types: DnsDiscoveredRecord (adds Flags/Tag the scan returns but generation drops), DnsRecordScanJob/Trigger, DnsRecordScanStatus enum. Pattern for enriching generated types.
│   │       ├── core-client.ts            # createCoreClient(options) — Core API
│   │       ├── compute-client.ts         # createComputeClient(options) — Edge Scripting
│   │       ├── db-client.ts              # createDbClient(options) — Database
│   │       ├── mc-client.ts              # createMcClient(options) — Magic Containers
│   │       ├── origin-errors-client.ts   # createOriginErrorsClient(options) — Origin Errors
│   │       ├── shield-client.ts          # createShieldClient(options) — Shield (WAF/DDoS/bots)
│   │       ├── storage-client.ts         # createStorageClient(options) — Edge Storage (region-specific)
│   │       ├── stream-client.ts          # createStreamClient(options) — Stream (video libraries)
│   │       └── generated/                # Generated .d.ts files (gitignored)
│   │           ├── core.d.ts
│   │           ├── compute.d.ts
│   │           ├── database.d.ts
│   │           ├── magic-containers.d.ts
│   │           ├── origin-errors.d.ts
│   │           ├── shield.d.ts
│   │           ├── storage.d.ts
│   │           └── stream.d.ts
│   │
│   ├── config/                            # @bunny.net/config package
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── scripts/
│   │   │   └── generate-schema.ts         # Generates JSON Schema from Zod schemas
│   │   ├── generated/
│   │   │   └── schema.json                # JSON Schema for bunny.jsonc (committed)
│   │   └── src/
│   │       ├── index.ts                   # Barrel export: schemas, types, conversion functions
│   │       ├── schema.ts                  # Zod schemas + inferred types: BunnyConfigSchema (root; optional app + sites), AppConfigSchema, SiteConfigSchema, BunnyAppConfigSchema (app required)
│   │       ├── convert.ts                 # API ↔ config conversion (apiToConfig, configToAddRequest, configToPatchRequest)
│   │       └── parse-image-ref.ts         # Docker image reference parser (parseImageRef)
│   │
│   ├── scriptable-dns-types/            # @bunny.net/scriptable-dns-types package
│   │   ├── package.json                 # types-only; exports "./index.d.ts" under the "types" condition
│   │   ├── index.d.ts                   # Ambient globals: ARecord/AaaaRecord/CnameRecord/TxtRecord/PullZoneRecord/Server, Monitoring/GeoDatabase/GeoDistance/RoutingEngine, DnsRequest/DnsQuery/GeoLocation
│   │   └── README.md
│   │
│   ├── database-shell/                   # @bunny.net/database-shell package
│   │   ├── package.json                  # bin: { "bsql": "./src/cli.ts" }
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── cli.ts                    # Standalone CLI entry point (bsql)
│   │       ├── index.ts                  # Barrel export: startShell, executeQuery, executeFile, types
│   │       ├── shell.ts                  # startShell() REPL engine, executeQuery(), executeFile()
│   │       ├── dot-commands.ts           # .tables, .schema, .fk, .er, .truncate, .dump, .count, .size, etc.
│   │       ├── format.ts                 # printResultSet(), masking, csvEscape
│   │       ├── parser.ts                 # splitStatements() SQL parsing
│   │       ├── views.ts                 # Saved views persistence (per-database)
│   │       ├── history.ts               # Shell history persistence
│   │       ├── types.ts                  # ShellLogger, ShellOptions, PrintMode
│   │       └── shell.test.ts            # Tests for shell utilities
│   │
│   ├── sandbox/                          # @bunny.net/sandbox package
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # Barrel export: Sandbox, Command, types
│   │       ├── sandbox.ts                # Sandbox class: create/get/fromHandle, runCommand (timeout/signal/onStdout/onStderr), writeFiles, readFile, listFiles, deleteFile, rename, exists, mkDir, exposePort, domain, getEnv/setEnv/unsetEnv (persisted env), delete, disconnect, Symbol.dispose/asyncDispose; backing MC app is named `sandbox-<name>` (appNameFor/sandboxNameFor)
│   │       ├── provision.ts              # Magic Containers app create/poll/endpoints + auth helpers + container env read/replace
│   │       ├── transport.ts              # ssh2 SSH/SFTP transport (exec with limits, file IO, reachability)
│   │       ├── command.ts                # Command (detached, logs()) and CommandFinished
│   │       ├── types.ts                  # Option and handle types
│   │       ├── errors.ts                 # SandboxError, CommandTimeoutError
│   │       └── sandbox.test.ts           # Tests for pure logic (command building, app extraction)
│   │
│   └── cli/                              # @bunny.net/cli package
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # Entry point: shebang + cli.parse()
│           ├── cli.ts                    # Root yargs instance, global flags, command registration
│           │
│           ├── core/
│           │   ├── agent-skill.ts        # Generic project skill installer: marked AGENTS.md block upsert + .claude/skills writes (Claude-gated for projects, ~/.claude/skills for --global)
│           │   ├── agent-skill.test.ts   # Tests for install/upsert idempotency, marker scoping, Claude gating
│           │   ├── client-options.ts     # clientOptions() helper — builds ClientOptions from ResolvedConfig
│           │   ├── define-command.ts     # Command factory (see "Command Pattern" below)
│           │   ├── define-namespace.ts   # Namespace/group factory for subcommand trees
│           │   ├── dns-nameservers.ts    # BUNNY_NAMESERVERS + expectedNameservers(zone) + checkDelegation()/checkDelegations(): reads the parent zone's NS referral (raw UDP query of the registry, not the recursive answer a child host could spoof; falls back to dns.resolveNs when the referral is unreadable), matches the full expected set both ways, ground truth over bunny's NameserversDetected flag which defaults true on a fresh zone; checkDelegations is bounded-concurrency for the zone list
│           │   ├── dns-record-types.ts   # Canonical DNS record-type name⇄integer map (RECORD_TYPES) + RECORD_TYPE_META (dashboard taxonomy: short label, friendly name, Standard/Bunny group) + recordTypeLabel() (bunny's canonical labels: PZ/RDR/SCR/Flatten for the bunny-specific types) + recordTypeFromLabel() (parses canonical labels and enum-key names); shared by commands/dns + core/hostnames
│           │   ├── errors.ts             # Re-exports UserError/ApiError from @bunny.net/openapi-client + ConfigError + errorMessage()
│           │   ├── format.ts             # Shared table/key-value rendering (text, table, csv, markdown)
│           │   ├── format.test.ts        # Tests for format utilities
│           │   ├── hostnames/            # Reusable pull-zone hostname feature (mounted by scripts; apps next)
│           │   │   ├── index.ts          # Re-exports client helpers, DNS/flow helpers + createHostnamesCommands
│           │   │   ├── client.ts         # hostnameUrl(), normalizeHostname(), addHostname() (idempotent: a rejected duplicate the zone already serves reports alreadyAttached instead of throwing, so partial-setup retries reach their follow-up steps), fetchPullZoneHostnames(), enableSsl() (verifies HasCertificate landed on the exact hostname after loadFreeCertificate, since the endpoint can 200 without one; throws and skips Force SSL then), hostnameHasCertificate(), probeTlsCertificate() (best-effort HTTPS handshake check: ok/bad-certificate/unreachable), createPullZone() (storage-zone origin), systemHostname() + Hostname/ResolvedPullZone types
│           │   │   ├── client.test.ts    # Tests for hostnameUrl() scheme logic, addHostname already-attached tolerance + enableSsl certificate verification
│           │   │   ├── dns.ts            # dnsPointsAt()/anyResolverPointsAt(): DNS checks (CNAME or flattened A records) via system + public (1.1.1.1/8.8.8.8) resolvers, injectable for tests
│           │   │   ├── dns.test.ts       # Tests for DNS matching + multi-resolver checks with fake resolvers
│           │   │   ├── flow.ts           # offerDnsWaitAndSsl(): poll DNS + opportunistically attempt SSL issuance (~30s) since bunny's resolvers decide validation; printSslHint(). dnsAlreadyLive skips the poll (Bunny DNS record already live). offerBunnyDnsThenSsl() takes an optional onBunnyDnsZone(zone) callback fired when the hostname is on Bunny DNS (lets the command layer link the directory). reportIssuedCertificate(): issued-cert summary that TLS-probes the hostname first (retrying once) and warns instead of printing "Live at" when the edge answers with a bad certificate (e.g. an overlapping wildcard on another zone shadowing a deeper subdomain); wildcards skip the probe. setupHostname(): resource-agnostic add-hostname -> DNS -> SSL orchestration (caller supplies sslHint/retryHint); used by scripts setupCustomDomain and storage zone add
│           │   │   ├── bunny-dns.ts       # findBunnyDnsZone()/offerBunnyDnsRecord(): detect a hostname inside an account Bunny DNS zone, then add/repoint a PullZone record (always confirmed) so SSL can issue immediately
│           │   │   ├── bunny-dns.test.ts  # Tests for longest-suffix zone matching + record-name derivation with a fake core client
│           │   │   └── commands.ts       # createHostnamesCommands(): add/ssl/list/remove factory parameterized by a pull-zone resolver; add treats an already-attached hostname as success (reported, and onAdded still runs, so retries finish companion/state work); onAdded runs AFTER the DNS/SSL flow (try/finally: it runs even when that flow throws, since the hostname did attach; only an attach failure skips it), so hook output never interleaves with the apex messages; remove guards its confirmation with requireConfirmable (unattended runs need --force)
│           │   ├── bunny-config.ts       # Shared bunny.jsonc discovery + raw read (findConfigRoot, configPath, configExists, readBunnyConfig); used by apps/ and sites/ config.ts
│           │   ├── jsonc.ts              # syncJsonc(): surgical JSONC editing that preserves comments, key order, and sibling blocks
│           │   ├── jsonc.test.ts         # Tests for syncJsonc (comment/formatting preservation, key add/remove)
│           │   ├── logger.ts             # Chalk-based structured logger
│           │   ├── manifest.ts           # .bunny/ context file resolution (load, save, resolveManifestId)
│           │   ├── registrar.ts          # detectRegistrar()/parseRegistrar(): best-effort registrar name via RDAP (used by dns zones add to name the registrar in next-steps)
│           │   ├── registrar.test.ts     # Tests for parseRegistrar RDAP parsing + legal-suffix tidying
│           │   ├── stats.ts              # Shared stats rendering: sumChart(), renderBarChart(), formatBucketLabel() (UTC date labels), BAR_WIDTH (used by dns/zone/stats + scripts/stats)
│           │   ├── stats.test.ts         # Tests for stats helpers
│           │   ├── types.ts              # GlobalArgs, OutputFormat, and shared type definitions
│           │   ├── ui.ts                 # readPassword(), confirm(), confirmTyped(), requireConfirmable() (unattended runs must pass --force instead of hanging on a prompt), spinner() wrappers
│           │   ├── ui.test.ts            # Tests for requireConfirmable (no-TTY guard, --force bypass)
│           │   └── version.ts            # VERSION constant from package.json
│           │
│           ├── config/
│           │   ├── index.ts              # resolveConfig(), loadConfigFile(), setProfile(), deleteProfile(), profileExists()
│           │   ├── schema.ts             # Zod schemas for config file and profiles
│           │   └── paths.ts              # XDG-compliant config file path resolution
│           │
│           ├── commands/
│           │   ├── apps/                 # Experimental — hidden from help and landing page
│           │   │   ├── APPS.md           # Apps documentation (while experimental)
│           │   │   ├── index.ts          # defineNamespace("apps", false) — hidden, registers all app commands
│           │   │   ├── constants.ts      # Status label maps + APP_MANIFEST filename + AppManifest interface (consumed via core/manifest.ts)
│           │   │   ├── config.ts         # bunny.jsonc app I/O over core/bunny-config.ts + core/jsonc.ts (loadConfig requires an `app` block; saveConfig strips transient `image`/`registry`/`app.id` via stripTransientFields and edits existing files surgically), re-exports from @bunny.net/config; provides resolveAppId, resolveContainerId, resolveContainerRegistry
│           │   │   ├── docker.ts         # Docker + registry helpers (build, push, dockerLogin, ensureRegistryLogin, dockerHasCredentials, ghDockerLogin, generateTag, promptRegistry, resolveRegistryForImage, getConfigSuggestions, imageHostname, parseDockerfileExposedPorts/readDockerfileExposedPorts, findDockerfiles/isDockerfileName/defaultContainerNameFromDockerfile/assignContainerNamesToDockerfiles for monorepo Dockerfile discovery)
│           │   │   ├── suggestions.ts    # Shared endpoint/env-var suggestion prompting (confirmEndpointSuggestions, endpointRequestToConfig, promptSuggestedEnv, filterNewEndpointSuggestions, filterNewEnvSuggestions) - used by walkthrough.ts and deploy.ts (post-push)
│           │   │   ├── init.ts           # Scaffold bunny.jsonc (detects Dockerfile, prompts for registry)
│           │   │   ├── link.ts           # Link this directory to an existing MC app (writes .bunny/app.json)
│           │   │   ├── unlink.ts         # Remove .bunny/app.json
│           │   │   ├── list.ts           # List all apps
│           │   │   ├── show.ts           # Show app details and overview
│           │   │   ├── deploy.ts         # Deploy app: positional <image>, --dockerfile, --container, --port, --command, --dry-run, --no-push
│           │   │   ├── undeploy.ts       # Undeploy app
│           │   │   ├── restart.ts        # Restart app
│           │   │   ├── delete.ts         # Delete app (also drops .bunny/app.json if it pointed at this app)
│           │   │   ├── pull.ts           # Sync API → bunny.jsonc + .bunny/app.json
│           │   │   ├── push.ts           # Sync bunny.jsonc → API (uses manifest for registry IDs)
│           │   │   ├── walkthrough.ts    # Shared new-app walkthrough used by init and deploy (runWalkthrough, runComposeImport, runMultiDockerfileImport with chooseDockerfiles for one-or-many Dockerfile selection in monorepos) - returns { config, registries } so the caller can write the manifest after creating the app
│           │   │   ├── compose/          # docker-compose import: parse, translate, validate
│           │   │   │   ├── index.ts      # findComposeFile, loadComposeFile, composeToConfig
│           │   │   │   ├── schema.ts     # Zod schema for compose subset
│           │   │   │   ├── find.ts       # locate compose.yml / docker-compose.yml
│           │   │   │   ├── ports.ts      # parsePortMapping (short/long/IP-prefixed forms)
│           │   │   │   ├── translate.ts  # service → ContainerConfig, warnings, hard errors
│           │   │   │   └── *.test.ts     # ports, translate, load
│           │   │   ├── env/
│           │   │   │   ├── index.ts      # defineNamespace("env", ...)
│           │   │   │   ├── list.ts       # List env vars per container
│           │   │   │   ├── set.ts        # Set env var (read-modify-write)
│           │   │   │   ├── remove.ts     # Remove env var
│           │   │   │   ├── pull.ts       # Pull env vars to .env file
│           │   │   │   ├── push.ts       # Bulk import .env file to remote (merge or --replace, --dry-run)
│           │   │   │   ├── parse.ts      # Minimal dotenv parser (no shell expansion)
│           │   │   │   └── parse.test.ts # parser unit tests
│           │   │   ├── endpoints/
│           │   │   │   ├── index.ts      # defineNamespace("endpoints", ...)
│           │   │   │   ├── list.ts       # List endpoints per container
│           │   │   │   ├── add.ts        # Add CDN or Anycast endpoint
│           │   │   │   ├── remove.ts     # Remove endpoint
│           │   │   │   ├── format.ts     # endpointTarget()/collectDeployedEndpoints() - resolve cdn→https URL, anycast/publicIp→IP; used by deploy.ts post-deploy
│           │   │   │   └── format.test.ts # endpoint target/collection unit tests
│           │   │   ├── volumes/
│           │   │   │   ├── index.ts      # defineNamespace("volumes", ...)
│           │   │   │   ├── list.ts       # List volumes
│           │   │   │   └── remove.ts     # Remove volume
│           │   │   └── regions/
│           │   │       ├── index.ts      # defineNamespace("regions", ...)
│           │   │       ├── list.ts       # List available regions
│           │   │       └── show.ts       # Show app region settings
│           │   ├── auth/
│           │   │   ├── login.ts          # Browser-based login via Bun.serve() callback (top-level: bunny login)
│           │   │   └── logout.ts         # Profile removal with --force confirmation bypass (top-level: bunny logout)
│           │   ├── config/
│           │   │   ├── index.ts          # defineNamespace("config", ...) — registers init, show, profile
│           │   │   ├── init.ts           # First-time setup (delegates to profile create)
│           │   │   ├── show.ts           # Display resolved config as table or JSON
│           │   │   └── profile/
│           │   │       ├── index.ts      # defineNamespace("profile", ...) — registers create + delete
│           │   │       ├── create.ts     # Add profile with masked API key input
│           │   │       └── delete.ts     # Remove a profile
│           │   ├── whoami.ts             # Show authenticated account: name, email, account id, profile (top-level: bunny whoami)
│           │   ├── db/
│           │   │   ├── index.ts               # defineNamespace("db", ...) — registers all database commands
│           │   │   ├── constants.ts           # Database status labels, region maps
│           │   │   ├── api.ts                 # Shared: typed v2 database/token API calls (fetchDatabase, fetchAllDatabases, generateToken, fetchLiveStatus, …)
│           │   │   ├── create.ts              # Create a new database (interactive region selection or flags)
│           │   │   ├── delete.ts              # Delete a database (double confirmation or --force)
│           │   │   ├── docs.ts                # Open database documentation in browser
│           │   │   ├── link.ts                # Link directory to a database (.bunny/database.json)
│           │   │   ├── list.ts                # List all databases
│           │   │   ├── quickstart.ts          # Generate quickstart guide for connecting to a database
│           │   │   ├── quickstart-snippets.ts # Shared: per-language connection code snippets (TypeScript, Go, Rust, .NET)
│           │   │   ├── region-choices.ts      # Shared: grouped region prompt choices by continent
│           │   │   ├── resolve-db.ts          # Helper: resolve database ID from flag, manifest, .env, or interactive prompt
│           │   │   ├── shell.ts               # Thin wrapper: credential resolution + delegates to @bunny.net/database-shell
│           │   │   ├── show.ts                # Show database details (regions, size, status)
│           │   │   ├── studio.ts              # Open a visual database explorer in the browser (local web UI)
│           │   │   ├── usage.ts               # Show database usage statistics
│           │   │   ├── regions/
│           │   │   │   ├── index.ts     # defineNamespace("regions", ...) — registers region commands
│           │   │   │   ├── add.ts       # Add primary/replica regions (interactive multiselect or flags)
│           │   │   │   ├── list.ts      # List configured primary and replica regions
│           │   │   │   ├── remove.ts    # Remove primary/replica regions
│           │   │   │   └── update.ts    # Interactive multiselect to toggle all regions on/off
│           │   │   └── tokens/
│           │   │       ├── index.ts      # defineNamespace("tokens", ...) — registers token commands
│           │   │       ├── create.ts     # Generate an auth token (read-only/full-access, optional expiry)
│           │   │       └── invalidate.ts # Invalidate all tokens for a database (with confirmation)
│           │   ├── dns/
│           │   │   ├── index.ts          # defineNamespace("dns", ...): registers the records + zones + scripts groups (+ hidden domain aliases)
│           │   │   ├── api.ts            # CoreClient type, fetchZones/fetchZone, resolveZone (domain-or-ID → zone), scanZoneRecords (trigger + poll bunny's server-side record scan via /dnszone/records/scan; matches the triggered JobId, falling back to "differs from the prior job" when the trigger omits one; returns corrected DnsDiscoveredRecord[] with Flags/Tag; uses DnsRecordScanStatus enum)
│           │   │   ├── constants.ts      # DNS_MANIFEST (".bunny/dns.json") + DnsManifest type, written by `dns zones link`
│           │   │   ├── interactive.ts    # resolveZoneInteractive (arg → .bunny/dns.json manifest → zone picker; errors instead of prompting when non-interactive (json output or no TTY, see core/ui.ts isInteractive); ignoreManifest forces the picker for `zones link`; offerLink prompts to link a picked zone) + resolveRecordInteractive; autoLinkDnsZone (link a zone found in another flow — silent write, confirm before relinking a different zone) reused by scripts custom-domain setup
│           │   │   ├── record-types.ts   # Re-exports RECORD_TYPES/RECORD_TYPE_META/recordTypeLabel from core/dns-record-types.ts; adds parseRecordType (accepts canonical labels + enum-key names), recordName, formatRecordValue
│           │   │   ├── record/            # `dns records` — entries within a zone (canonical: records; aliases: record, rec)
│           │   │   │   ├── index.ts      # defineNamespace("records", ...)
│           │   │   │   ├── list.ts       # List records in a zone (alias: ls)
│           │   │   │   ├── add.ts        # Add a record (positional grammar per type, or interactive wizard; --pull-zone/--script). Interactive wizard first offers "single record" vs a preset (pickAndApplyPreset); A/AAAA/CNAME/TXT offer static vs script-computed (Scriptable DNS) via pickOrCreateDnsScript: pick or create+seed a DNS script and write a SCRIPT record. Exports addRecordInteractive (the single-record wizard) reused by zone/add.ts's next-steps menu
│           │   │   │   ├── update.ts     # Update a record (alias: edit; prompts to pick zone+record when omitted)
│           │   │   │   ├── remove.ts     # Remove a record (alias: rm; prompts to pick zone+record when omitted)
│           │   │   │   ├── preset.ts     # `records preset [name] [domain]` (`list` lists; `--param key=value` repeatable for non-interactive runs): pick/apply a preset, gather params (flags then prompts in text mode), summarize, confirm, bulk-write. `--output json` writes then serializes the result; mid-sequence failures report how many records landed. Exports pickAndApplyPreset reused by add.ts
│           │   │   │   ├── presets.ts    # Preset catalog (data + pure build fns): google-workspace, microsoft365/outlook, zoho, mailgun, resend, proton, bluesky, dmarc, caa, no-email. findPreset(id|alias)
│           │   │   │   ├── presets.test.ts # Tests for the pure preset build fns + alias resolution
│           │   │   │   ├── write.ts      # Shared writeRecords (per-record PUT, resilient: collects {applied, failures} so one bad record can't strand the batch) + reviewAndApply (multiselect pre-checked records in text, write, report partial failures, serialize on json); used by preset.ts, scan.ts, zone/add.ts
│           │   │   │   ├── scan-records.ts # discoverImportableRecords: scanZoneRecords + map discovered → AddDnsRecordModel (carries Flags/Tag, reconstructs CAA flags/tag from rdata as a fallback), drop apex SOA/NS but keep delegated subdomain NS, dedupe vs existing records by type + normalized name/value (trailing-dot/case) + type-specific fields (priority/weight/port/flags/tag)
│           │   │   │   ├── scan-records.test.ts # Tests for the discovered-record mapping/filter/dedupe
│           │   │   │   ├── scan.ts       # `records scan [domain]` (--yes): discover the domain's existing records (server-side scan) and reviewAndApply them; reused at zone creation
│           │   │   │   ├── import.ts     # Import records from a BIND zone file (prompts for zone/file when omitted). Exports importZoneFile reused by zone/add.ts's next-steps menu
│           │   │   │   └── export.ts     # Export records as a BIND zone file (stdout, --file <path>, or --save → <domain>.zone)
│           │   │   └── zone/              # `dns zones` — the zone itself (canonical: zones; aliases: zone; hidden: domain, domains)
│           │   │       ├── index.ts      # defineNamespace("zones", ...) + dnsZoneHiddenAliases (domain/domains)
│           │   │       ├── list.ts       # List all DNS zones (alias: ls); Nameservers column from a live per-zone NS lookup, not bunny's NameserversDetected flag
│           │   │       ├── add.ts        # Create a DNS zone (prompts for the domain when omitted; required non-interactively), then offerNextSteps menu (scan for existing records via scanAndImport: discoverImportableRecords + reviewAndApply / upload a zone file via importZoneFile / add records manually via addRecordInteractive / continue); --import scans and imports all without prompting and surfaces failures as a JSON ImportError + nonzero exit, --no-import skips the menu; then print the bunny nameservers (naming the registrar via core/registrar.ts when RDAP resolves it). Menu is TTY-gated so `zones add <domain>` stays scriptable
│           │   │       ├── link.ts       # Link this directory to a zone → .bunny/dns.json (arg, else pick interactively)
│           │   │       ├── unlink.ts     # Remove .bunny/dns.json (alias-free; --force skips confirm)
│           │   │       ├── show.ts       # Show zone details (nameservers, SOA, DNSSEC, logging, record count)
│           │   │       ├── remove.ts     # Delete a DNS zone and its records (alias: rm)
│           │   │       ├── stats.ts      # Show DNS query statistics (TotalQueriesServed, by-type bar chart in text mode)
│           │   │       ├── nameservers.ts # Check delegation (alias: ns): live NS lookup; on success a confirmation, otherwise the same "update your nameservers at [registrar]" guidance as zone add
│           │   │       ├── dnssec/
│           │   │       │   ├── index.ts  # defineNamespace("dnssec", ...)
│           │   │       │   ├── enable.ts # Enable DNSSEC, print DS record for the registrar
│           │   │       │   └── disable.ts # Disable DNSSEC (with confirmation)
│           │   │       └── logging/
│           │   │           ├── index.ts  # defineNamespace("logging", ...)
│           │   │           ├── enable.ts # Enable DNS query logging (optional IP anonymization)
│           │   │           └── disable.ts # Disable DNS query logging (with confirmation)
│           │   │   └── scripts/          # `dns scripts`: Scriptable DNS scripts (canonical: scripts; alias: script). Reuses the compute API (EdgeScriptType 0); separate from `bunny scripts` (different runtime, no pull zone)
│           │   │       ├── index.ts      # defineNamespace("scripts", ...): init/create/deploy/attach/link/list
│           │   │       ├── constants.ts  # DNS_SCRIPT_MANIFEST (".bunny/dns-script.json") + DnsScriptManifest; SCRIPT_TYPE_DNS; inline EXAMPLES (empty/geo/closest/weighted/failover/pullzone); TSCONFIG + TYPES_PACKAGE scaffold strings
│           │   │       ├── api.ts        # ComputeClient helpers: fetchDnsScripts/fetchDnsScript (type 0), createDnsScript (no pull zone), uploadCode, publishScript
│           │   │       ├── interactive.ts # resolveDnsScriptId (arg → .bunny/dns-script.json → DNS-script picker)
│           │   │       ├── init.ts       # Scaffold a project: example chooser, handleQuery.js + tsconfig + package.json (devDep on @bunny.net/scriptable-dns-types) + manifest; optional --deploy
│           │   │       ├── create.ts     # Create the remote DNS script (no pull zone), link manifest
│           │   │       ├── deploy.ts     # Upload code (single file, no build) + publish; prompts for the file when omitted, --skip-publish to stage
│           │   │       ├── attach.ts     # Bridge: add a SCRIPT record on a zone pointing at the script. `attach [domain] [name] --script <id>`; always confirms (apex gets a louder root-domain warning, lists existing records at the name), --force skips and is required to write non-interactively
│           │   │       ├── link.ts       # Link this directory to an existing DNS script → .bunny/dns-script.json (positional id, else pick interactively; preserves entry)
│           │   │       └── list.ts       # List DNS scripts (alias: ls)
│           │   ├── storage/                 # Experimental (hidden from help and landing page)
│           │   │   ├── index.ts          # defineNamespace("storage", ...): registers zone + file groups + link + regions + docs (+ hidden bucket aliases)
│           │   │   ├── api.ts            # CoreClient type, fetchStorageZones/fetchStorageZone, resolveStorageZone (name-or-ID to zone, re-fetched by ID), toSafeStorageZone (strips Password/ReadOnlyPassword; used by every command that emits a raw zone as JSON: show/list/add)
│           │   │   ├── constants.ts      # STORAGE_REGIONS (from SDK enum; /storagezone/regions API endpoint is not reliable) + replicationChoices/normalizeReplicationRegions (replication uses the same regions minus the primary; the SDK file ZoneSchema is the physical footprint, NOT the create input) + STORAGE_MANIFEST/StorageZoneManifest (.bunny/storage.json, written by storage link)
│           │   │   ├── interactive.ts    # resolveStorageZoneInteractive: explicit name/ID arg → linked manifest (.bunny/storage.json, fetched by ID even when non-interactive) → zone picker; opts: force (no picker), offerLink (picker offers to link the directory), ignoreManifest (always pick, used by link); writeStorageManifest writer shared with link
│           │   │   ├── link.ts           # Link the current directory to a storage zone (.bunny/storage.json) via the shared resolver with ignoreManifest; bunny storage link [zone]
│           │   │   ├── unlink.ts         # Remove .bunny/storage.json (confirmation unless --force); bunny storage unlink
│           │   │   ├── files-api.ts      # Adapter over @bunny.net/storage-sdk: connectStorageZone (zone → SDK connection, Region→StorageRegion enum + password), listFiles/uploadFile/downloadFile/deleteFile (deleteFile translates the SDK's boolean return into a UserError)
│           │   │   ├── files-api.test.ts # Tests for region mapping + delete error translation (NOT the SDK's URL building)
│           │   │   ├── s3.ts             # S3 (closed preview): isS3Enabled (StorageZoneType===1), s3Endpoint (<region>-s3.storage.bunnycdn.com), s3Credentials (name=access key, password=secret), renderS3ToolConfig (rclone/aws/s3cmd/env formatters)
│           │   │   ├── s3.test.ts        # Tests for S3 derivation + tool-config formatters
│           │   │   ├── docs.ts           # Open storage docs (bunny storage docs)
│           │   │   ├── regions.ts        # List available storage regions (bunny storage regions)
│           │   │   ├── zone/              # `bunny storage zones` (canonical: zones; aliases: zone; hidden: bucket, buckets)
│           │   │   │   ├── index.ts      # defineNamespace("zones", ...) + storageZoneHiddenAliases (bucket/buckets)
│           │   │   │   ├── list.ts       # List all storage zones (alias: ls)
│           │   │   │   ├── add.ts        # Create a storage zone (prompts for name + region when omitted; offers/--pull-zone creates a pull zone via core/hostnames createPullZone, then offers/--domain a custom domain via setupHostname). Under --output json it stays non-interactive: --domain is attached via addHostname (no DNS/SSL prompts) and reported in the CustomDomain field (with cnameTarget or error)
│           │   │   │   ├── show.ts       # Show zone details (region, replication, hostname, usage; adds S3 endpoint rows when S3-enabled)
│           │   │   │   ├── credentials.ts # S3 credentials / tool config for the zone (alias: creds; --format, --read-only, --show-secret); table and JSON mask the secret unless --show-secret, --format always emits it in full
│           │   │   │   ├── update.ts     # Update zone settings (custom 404, rewrite 404->200, replication); replication is additive (replicas can't be removed, so existing ones are kept and the prompt only offers new regions, confirming before adding); interactive pre-filled editor when no flags (a mid-flow cancel aborts the whole edit); --output json/non-TTY/--force require flags and error "No changes requested." without them
│           │   │   │   ├── remove.ts     # Delete a storage zone and its files (alias: rm); double confirmation (yes/no + type the zone name) unless --force, and removes a stale .bunny/storage.json that pointed at the deleted zone
│           │   │   │   └── hostnames/index.ts  # Mounts core/hostnames createHostnamesCommands as "storage zones domains" (alias hostnames); resolver maps a storage zone (name/ID positional, else linked zone, else picker via resolveStorageZoneInteractive; --pull-zone) to its linked pull zone
│           │   │   └── file/              # `bunny storage files` (canonical: files; aliases: file); zone is the --zone/-z flag (defaults to linked zone), the positional is the file/path
│           │   │       ├── index.ts      # defineNamespace("files", ...)
│           │   │       ├── list.ts       # List files in a directory (alias: ls; directories first; [path] positional, --zone flag)
│           │   │       ├── upload.ts     # Upload a local file (<file> positional, --zone, --to, --checksum streams a SHA256, --content-type)
│           │   │       ├── download.ts   # Download a file to disk (<path> positional, --zone, --out)
│           │   │       └── remove.ts     # Delete a file or directory (alias: rm; <path> positional, --zone, trailing slash = recursive)
│           │   ├── sites/                 # Static-site hosting (storage zone + pull zone + middleware router)
│           │   │   ├── index.ts          # defineNamespace("sites", ...): create/list/show/deploy/deployments/domains/link/unlink/upgrade-router/delete
│           │   │   ├── constants.ts      # SITES_MANIFEST (.bunny/site.json), REMOTE_STATE_PATH (_bunny/site.json), RemoteSiteState/DeployRecord types (DeployRecord carries previewZoneId/previewHost; state carries routerVersion), parseRemoteState (shape-checked; null = not a site), deployPrefix, deploy-ID + site-name validators (3-47 chars; `dpl-` names reserved so a site can't collide with preview-zone names), suffixedResourceName/siteResourcePattern (zone names are `sites-{name}-{random 6}`: the prefix marks them in the dashboard, the suffix dodges the global zone namespace), previewZoneName/deployIdFromPreviewZoneName/isPreviewZoneName (`sites-dpl-{deployId}-{rand6}` preview zones: no dashes in deploy ids keeps parsing unambiguous, and the worst case fits the 63-char DNS label limit)
│           │   │   ├── constants.test.ts # parseRemoteState round-trip/rejection + helper tests
│           │   │   ├── api.ts            # siteFiles IO seam (connect/download/upload/remove; swap in tests instead of mock.module), remote state read/write (sha256 etag optimistic lock: concurrent deploy records merge on mismatch, ours win per id; current/previous follow promotedTo, so last promote wins and non-promoting writers adopt the concurrent pointers), siteContextFromZone, fetchSites (pull zone listing → middleware+storage candidates → per-zone state verification), createSite (idempotent provisioning: storage zone → router script code+publish+CURRENT_DEPLOY → pull zone + MiddlewareScriptId attach → state; both zones share a random name suffix so globally-taken names can't block the create, retrying fresh suffixes on collision; resume adopts a stateless name-pattern zone, and state.name keeps the clean site name), promoteDeploy (env var PUT + purgeCache POST), ensureRouterCurrent (republishes the router when state.routerVersion lags ROUTER_VERSION, so preview hostnames can't silently serve production on a stale router), ensurePreviewZone (per-deploy preview pull zone `sites-dpl-{id}-{rand6}`: adopt-by-name+storage-zone first so a failed state write converges on retry, else create with fresh-suffix retries. A pull zone is public the instant it exists and an unrouted one serves the raw storage origin, so the router goes on in the create call itself (PullZoneAddModel.MiddlewareScriptId); the follow-up attach POST confirms it and is what repairs an adopted orphan, and if it fails a zone this run created is deleted rather than left exposed. Force SSL uses the derived b-cdn.net host (responses don't always carry Hostnames) and a failure returns ready:false, which keeps the zone out of the deploy record so the next deploy re-adopts and repairs it; null on failure, the deploy warns and retries next run), findPreviewZones (name shape + StorageZoneId sweep, catches zones missing from state) + deletePreviewZone (best-effort; 404 counts as deleted so retries converge), fetchSystemHostname, deleteSiteResources (preview zones → pull zone → script → storage zone, best-effort; a failed preview sweep aborts BEFORE anything is deleted, since the storage zone is the association key the sweep needs), deleteDeployFiles. fetchSites skips preview-shaped candidates by name before any state read
│           │   │   ├── api.test.ts       # In-memory siteFiles store + path-branching fake clients: state round-trip, etag conflict, createSite fresh/resume/already-exists, promote, fetchSites filtering
│           │   │   ├── interactive.ts    # selectSite: explicit ref (storage zone ID/name, falling back to a state.name match since zone names carry a suffix) → .bunny/site.json → bunny.jsonc sites.name → picker (offerLink like scripts); `force` errors instead of opening the picker (destructive commands pass their --force, which also skips the confirmation, so a picked site would be acted on unprompted; deploy's --force means "redeploy unchanged content" and is not passed); optional offerCreate (deploy only) adds a new-vs-existing prompt, and creates straight away when the account has no sites; siteOptionBuilder (--site) + sitePositionalBuilder ([site]) + siteLinkOption (--link, mounted only by the commands that call offerLink); an explicit --link links whatever site was resolved (ref or bunny.jsonc included) during resolution, not via offerLink, since every command returns from its `--output json` branch before offerLink runs (and the confirmation line is suppressed under json); the picker keeps prompting unless --link/--no-link already decided it
│           │   │   ├── provision.ts       # promptSiteName (normalize/validate, directory-name suggestion) + createSiteWithProgress (createSite under a step-tracking spinner; shared with create.ts) + createLinkedSite (create + manifest link → SiteContext, skipping create's domain/CI prompts) for the deploy picker's new-site branch
│           │   │   ├── config.ts         # loadSiteConfig: reads bunny.jsonc via core/bunny-config.ts and validates ONLY the `sites` block (SiteConfigSchema from @bunny.net/config), so sites-only configs work without an `app` block or `version`
│           │   │   ├── router/source.ts  # routerSource + ROUTER_VERSION (recorded in site state; deploy republishes stale routers via ensureRouterCurrent and purges preview-zone caches on upgrade): the middleware Edge Script (one script per site, attached to the main pull zone AND every preview zone). CRITICAL platform gotcha: at the edge ctx.request.url is the ORIGIN-facing address (http://<edge-ip>:9000/...), NOT the requested host; the client hostname comes from the CDN-Host/Host headers (clientHostname()), and the index-retry probe URL must be rebuilt on that host so it re-enters the CDN instead of hitting unrouted storage paths. production hosts → CURRENT_DEPLOY, sites-dpl-{id}-{rand6}.b-cdn.net → that deploy (both root-served, so client-side routers and root-absolute assets work as-is), /_bunny/* → 403 (the client-sent x-bunny-index-retry header is stripped; the flag is router-internal), trailing-slash → index.html, and a slashless GET/HEAD 404 probes its directory index (re-entrant HEAD of the URL + "/") and 301-redirects to the slash URL when it exists (so /blog resolves in production and previews with the right relative-URL base, while exact extensionless objects and dotted directories stay reachable). onOriginResponse: X-Robots-Tag: noindex on preview hosts
│           │   │   ├── deploy-id.ts      # gitIdentity (short sha + dirty check via Bun.spawn), contentHashId (sorted path+sha256 merkle → 8 hex), resolveDeployIdentity (clean git → sha, else content hash)
│           │   │   ├── deploy-id.test.ts # Hash determinism + real temp git repos (clean → sha, dirty → content hash)
│           │   │   ├── uploader.ts       # collectFiles (recursive walk, skips dotfiles/node_modules, sorted), hashFiles (streaming sha256), uploadDeploy (8-way concurrency, per-file checksum, 3-attempt backoff retry) via siteFiles.upload
│           │   │   ├── uploader.test.ts  # Walk/skip/hash tests + upload paths/checksums/retry via siteFiles swap
│           │   │   ├── build.ts          # resolveAutoBuild (framework preset or package.json build script, via ci/frameworks detection) + runBuildCommand (Bun.spawn shell, caller env + overrides, throws on non-zero exit)
│           │   │   ├── build.test.ts     # Env parsing + real build spawn success/failure
│           │   │   ├── create.ts         # bunny sites create [name] (falls back to `sites.name` in bunny.jsonc, else prompted with a directory-name suggestion): createSite (storage + router + pull zone; forces HTTPS on the system host, best-effort) + manifest link + custom production domain via setupSiteDomain (--domain flag, offered interactively when omitted; domain failure warns, never fails the create)
│           │   │   ├── list.ts           # List sites (name, URL, deploy count, current) via fetchSites
│           │   │   ├── show.ts           # Site details + hostname table (SSL cert + Force SSL columns); a failed hostname fetch hides the table, never the site
│           │   │   ├── open.ts           # bunny sites open [site]: open the live URL (recorded custom domain when the zone still serves it, else system host) in the browser; --print emits it, siteLiveUrl is the pure resolver
│           │   │   ├── ssl.ts            # bunny sites ssl [site]: toggle Force HTTPS on the site's b-cdn.net system host via setForceSsl (no cert issued; --no-force-ssl allows HTTP); custom domains use `sites domains ssl`
│           │   │   ├── deploy.ts         # bunny sites deploy [dir]: resolve site (picker offers to create a new site when none is linked) → build (--build resolves flag command → `sites.build` → detected build, failing before any site is created; no --build offers a detected/configured build interactively; without a dir arg, --build deploys the detected framework's output dir) → router upgrade check (ensureRouterCurrent; a failed republish skips preview creation so a stale router never serves production on a preview URL) → hash → no-op if unchanged → upload deploys/{id}/ → ensurePreviewZone (every deploy gets its own `sites-dpl-{id}-{rand6}.b-cdn.net` preview zone, recorded on the DeployRecord; no-op and skip-upload runs backfill a missing one so re-runs converge) → state write → publish when --production. Publishing is always explicit: --production/--prod, or the interactive offer when the site has no production deploy yet (a CI preview run on a fresh site must never go live). A domainless site's first-ever deploy also offers a custom production domain (setupSiteDomain, interactive text runs only); later domainless deploys print a dim `sites domains add` hint
│           │   │   ├── link.ts           # Link directory to a site (.bunny/site.json)
│           │   │   ├── unlink.ts         # Remove .bunny/site.json
│           │   │   ├── upgrade-router.ts # Republish the site's router script with the CLI's current source and record ROUTER_VERSION in state (deploy also auto-republishes stale routers)
│           │   │   ├── delete.ts         # Delete a site (typed-name confirm; --keep-storage; drops .bunny/site.json if it pointed here)
│           │   │   ├── ci/               # frameworks.ts (preset table of ~30 frameworks across js/ruby/hugo/python/zola/dotnet toolchains + detection: package.json deps/Gemfile/python+zola config files + lockfile pm), workflow.ts (renderSitesWorkflow -> .github/workflows/bunny-sites.yml using BunnyWay/actions/deploy-site; optional dir/build override the preset, workingDirectory/cacheDependencyPath place a project that sits below the workflow root (`defaults.run.working-directory` covers every run step, `uses` inputs take the prefix via workflowPath instead), installDeps adds the JS setup/install steps to a configured build the static preset wouldn't have installed for, and a configured build command is always a quoted scalar so YAML can't retype it), scaffold.ts (git helpers, projectPrefix (bunny.jsonc directory relative to the git root, realpath-resolved; undefined when it escapes the root, which drops its paths with a warning), framework/package-manager detection runs in that project directory, scaffoldSitesWorkflow -> ScaffoldResult.dir is the effective root-relative deploy dir, printWorkflowInstructions, offerGitHubSecret via gh), init.ts (bunny sites ci init) + tests
│           │   │   ├── deployments/      # list (● Live/○ Previous), publish [id]|--previous (alias promote; confirm + promote + current/previous swap), prune --keep N (resolveKeepCount validates the count first; pruneVictims never drops current/previous; each pruned deploy's preview zone is deleted first, discovered via findPreviewZones for records whose zone create raced a failed state write; a failed zone deletion keeps the record and files so the next prune retries) + prune.test.ts, delete [id] (single-deploy cleanup for CI, e.g. a closed PR's preview: deleteBlocker refuses current/previous with --force only skipping the confirmation, revalidated on freshly re-read state inside the destructive phase since PR cleanup can race the production publish of the same sha; an already-gone id is a no-op success so re-runs converge; a failed zone listing always aborts because a forgotten record would never be retried, unlike prune) + delete.test.ts
│           │   │   └── domains/index.ts  # Mounts core/hostnames createHostnamesCommands as "sites domains" with onAdded/onRemoved hooks: the first added domain is recorded as state.domain (display-only production URL; previews run on their own b-cdn.net zones and never depend on it; recordSiteDomain rolls back the in-memory value if the state write fails), and an add on a site with nothing published hints at `deploy --production` (the domain serves the router's 404 until then); remove clears state.domain. setupSiteDomain (create --domain + deploy's first-run offer) records the domain only once the hostname is verifiably on the zone
│           │   ├── registries/
│           │   │   ├── index.ts          # Manual CommandModule (not defineNamespace) — default handler runs list
│           │   │   ├── list.ts           # List container registries
│           │   │   ├── add.ts            # Add registry with credentials
│           │   │   ├── update.ts         # Update registry display name and/or rotate credentials
│           │   │   └── remove.ts         # Remove registry
│           │   ├── docs.ts               # Open bunny.net documentation in browser (top-level: bunny docs)
│           │   ├── open.ts               # Open bunny.net dashboard in browser (top-level: bunny open)
│           │   ├── skills/
│           │   │   ├── index.ts          # defineNamespace("skills", ...) registers skills commands
│           │   │   ├── content.ts        # BUNNY_CLI_SKILL: embeds skills/bunny-cli/** at bundle time via Bun text imports (single source of truth) + compact AGENTS.md section
│           │   │   ├── content.test.ts   # Guards: every reference SKILL.md routes to is embedded; section stays compact
│           │   │   └── install.ts        # bunny skills install [--global]: project (AGENTS.md + Claude-gated .claude/skills) or global (~/.claude/skills)
│           │   └── scripts/
│           │       ├── index.ts          # defineNamespace("scripts", ...) — registers all script commands
│           │       ├── constants.ts      # SCRIPT_MANIFEST, SCRIPT_TYPE_LABELS
│           │       ├── api.ts            # Shared: fetchScript(s), fetchEnvEntries, fetchScriptHostnames, logLiveHostnames, promptOpenInBrowser
│           │       ├── create.ts         # Create a remote Edge Script (exports shared `createScript` + `setupCustomDomain`; for a linked script, setupCustomDomain auto-links the dir to the domain's Bunny DNS zone via autoLinkDnsZone)
│           │       ├── delete.ts         # Delete an Edge Script (double confirmation or --force)
│           │       ├── deploy.ts         # Deploy code to an Edge Script (publishes by default)
│           │       ├── docs.ts           # Open Edge Script documentation in browser
│           │       ├── init.ts           # Scaffold a new Edge Script project from a template (calls `createScript` + `setupCustomDomain`)
│           │       ├── interactive.ts     # resolveScriptInteractive(): explicit ID → linked manifest → picker (offers to link; skipped for JSON output)
│           │       ├── link.ts           # Link directory to a remote Edge Script (.bunny/script.json)
│           │       ├── list.ts           # List all Edge Scripts (Standalone + Middleware)
│           │       ├── show.ts           # Show Edge Script details + hostnames (supports manifest fallback)
│           │       ├── stats.ts          # Show Edge Script usage statistics (requests/CPU/cost totals + per-bucket bar chart with friendly UTC date labels; uses core/stats.ts)
│           │       ├── deployments/
│           │       │   ├── index.ts      # defineNamespace("deployments", ...)
│           │       │   ├── list.ts       # List deployments for an Edge Script
│           │       │   └── publish.ts    # Publish (roll back to) a past deployment by release ID
│           │       ├── hostnames/
│           │       │   └── index.ts      # Mounts core/hostnames factory: script pull-zone resolver + [id] positional (--id also accepted)/--pull-zone, visible as "domains" with hidden "hostnames" alias
│           │       └── env/
│           │           ├── index.ts      # defineNamespace("env", ...)
│           │           ├── list.ts       # List environment variables for a script
│           │           ├── set.ts        # Set environment variable
│           │           ├── remove.ts     # Remove environment variable
│           │           └── pull.ts       # Pull environment variables to .env file
│           │
│           ├── sandbox/                  # `sandbox`: ephemeral dev sandboxes over @bunny.net/sandbox
│           │   ├── index.ts              # defineNamespace("sandbox", ...) — registers all sandbox commands
│           │   ├── create.ts             # Create a sandbox (--region, -e/--env + --env-file bake persisted env vars in)
│           │   ├── list.ts               # List sandboxes
│           │   ├── delete.ts             # Delete a sandbox and its MC app (--force)
│           │   ├── exec.ts               # Run a command via SSH (-e/--env + --env-file inject temporary env vars; --timeout kills after N seconds, exit 124)
│           │   ├── cp.ts                 # Copy a file to/from a sandbox over SFTP (<sandbox>:<path> picks direction)
│           │   ├── resolve.ts            # Shared helpers: parseRemoteRef, sandboxFromName (rebuild a Sandbox from the stored record), connectSandbox (requires SSH endpoint)
│           │   ├── ssh.ts                # Open an interactive SSH shell (-e/--env + --env-file inject temporary env vars)
│           │   ├── ssh-exec.ts           # Shared SSH helpers: sshArgs, withSshEnv (askpass token), envPrefix (inline KEY='v' assignments)
│           │   ├── env-args.ts           # Shared -e/--env + --env-file parsing: withEnvOptions, collectEnv, parseDotenv, splitPair
│           │   ├── files/                 # `sandbox files` (alias: file): file operations over SFTP
│           │   │   ├── index.ts          # defineNamespace("files", ...)
│           │   │   └── list.ts           # List files in a sandbox directory (alias: ls; bare name = /workplace, or <sandbox>:<path>)
│           │   ├── url/                   # `sandbox url`: expose/list/delete public CDN endpoints for a port
│           │   │   ├── index.ts          # defineNamespace("url", ...)
│           │   │   └── add.ts / list.ts / delete.ts
│           │   └── env/                   # `sandbox env`: persisted env vars (survive restart, unlike exec/ssh temp env)
│           │       ├── index.ts          # defineNamespace("env", ...)
│           │       ├── set.ts            # Persist vars (KEY=VALUE pairs or --env-file), merges with existing
│           │       ├── list.ts           # List persisted vars (AGENT_TOKEN hidden)
│           │       └── delete.ts         # Remove persisted vars (aliases: rm, unset)
│           │
│           └── utils/                    # Shared utility functions
│
├── package.json                          # Workspace root (workspaces: ["packages/*"])
├── tsconfig.json                         # Base TypeScript config (extended by packages)
├── AGENTS.md                             # This file
└── bun.lock
```

### Conventions

- **Monorepo with Bun workspaces.** `packages/openapi-client/` is the standalone API client SDK; `packages/config/` provides shared Zod schemas, types, and API conversion functions for `bunny.jsonc`; `packages/database-shell/` is the standalone SQL shell engine; `packages/sandbox/` is the standalone sandbox SDK (provisioning + SSH transport); `packages/cli/` is the CLI.
- **API clients use `ClientOptions`** — an options object with `apiKey`, `baseUrl`, `verbose`, `userAgent`, and `onDebug`. The CLI provides a `clientOptions(config, verbose)` helper to build this from `ResolvedConfig`.
- **One command per file.** Each file in `commands/` exports a single command or namespace.
- **Commands are grouped by domain** in subdirectories (`config/`, `db/`, `scripts/`).
- **Namespaces are directories** with an `index.ts` that calls `defineNamespace()`.
- **Leaf commands** are individual `.ts` files that call `defineCommand()`.
- **Top-level commands** (`login`, `logout`, `whoami`) are registered directly in `cli.ts` without a namespace.
- **Shared internal code lives in `packages/cli/src/core/`** — command factories, errors, logger, format utilities, UI helpers, and shared types. Keep this mostly flat; a cohesive, reusable feature spanning several files may use a subdirectory (e.g. `core/hostnames/` — the pull-zone hostname helpers + the `createHostnamesCommands` factory mounted by both `scripts` and, in future, `apps`).
- **Config logic lives in `packages/cli/src/config/`** — schema, file resolution, and profile management.
- **Error classes are split.** `UserError` and `ApiError` live in `@bunny.net/openapi-client` (the SDK needs them). `ConfigError` lives in the CLI and extends `UserError`. The CLI's `errors.ts` re-exports `UserError` and `ApiError` from `@bunny.net/openapi-client`.
- **Import API clients from `@bunny.net/openapi-client`**, not relative paths. Import generated types from the per-API entrypoints (`@bunny.net/openapi-client/<spec>`, e.g. `@bunny.net/openapi-client/core`); the older `@bunny.net/openapi-client/generated/<spec>.d.ts` paths remain supported.
- **Mask secrets in human output; reveal only behind an explicit flag.** Any sensitive value (API keys, passwords, S3 secret keys, auth tokens) must be masked in the default table/text output and shown in full only when the user opts in with a flag (e.g. `--show-secret`). Use `maskSecret()` from `core/format.ts` for the masked form (it keeps the last 4 characters for identification). Tool-config output (`--format rclone|aws|...`) is the exception because it exists to be consumed by tools: it always emits full values. `--output json` masks like the table; `--show-secret` reveals there too. Never print a secret the user did not explicitly ask to see. Reference: `storage zones credentials` masks the S3 secret access key by default in both the table and JSON and reveals it with `--show-secret`, while never leaking it from inspect/list commands (see `toSafeStorageZone`).
- **Pull-zone settings are exposed via "Hybrid D" across surfaces.** Scripts and apps are backed by a pull zone, which has a large settings surface (hostnames, caching, edge rules, origin, security, purge, CORS, optimizer, logging, …). To keep each owner's help legible:
  - **Flatten only first-class groups** directly into the owner — picked by user mental model, kept to one or two. `scripts domains` is the flattened group (a custom domain is "my site's address," not a CDN setting).
  - **Group the long tail** under a `pullzone` sub-namespace within the owner (e.g. `scripts pullzone <setting>`), so the owner's top-level help gains one line, not ten. Curate per owner — don't expose settings that don't apply (a script _is_ its pull zone's origin, so no origin-URL command under `scripts`).
  - **A standalone `bunny pullzone` command** (planned) is the canonical full surface for pull zones not backing a script/app, targeted by `--id`.
  - Each setting-area is a **mountable factory** like `createHostnamesCommands` (`core/hostnames/`): one `{ commandPath, target, targetPositional, resolve(args) => { pullZoneId, coreClient }, hiddenAliases }` mounted into the root `pullzone` (resolve from `--id`), `scripts` (resolve from the linked manifest), and `apps` (resolve from the CDN endpoint). The resolver is the only per-surface difference. `targetPositional` appends an optional trailing positional (e.g. `[id]`) to every subcommand so mounts can match their namespace's positional-ID convention; the flag form of the same key keeps working.
  - Canonical term is `pullzone` (matches the bunny.net dashboard/API); `pz` is a hidden alias (`defineNamespace(alias, false, …)`), the same pattern as `domains`'s hidden `hostnames` alias.

---

## Command Pattern

Every command is defined through one of two factory functions. These enforce consistent structure, error handling, and lifecycle hooks across all commands.

### `defineCommand<A>(def)`

The primary factory. Equivalent to Cobra's `cobra.Command{}` struct:

```typescript
import { defineCommand } from "../../core/define-command";

export const myCommand = defineCommand<{
  env: string;
  dryRun: boolean;
}>({
  command: "deploy",
  aliases: ["d"],
  describe: "Deploy your project.",

  builder: (yargs) =>
    yargs
      .option("env", {
        alias: "e",
        type: "string",
        default: "production",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
      }),

  // Optional: runs before handler. Use for validation. (Cobra's PreRunE)
  preRun: async (args) => {
    if (!args.env) throw new UserError("--env is required");
  },

  // Main handler
  handler: async ({ env, dryRun, profile, verbose }) => {
    // profile, verbose, output are always available (global flags)
  },

  // Optional: runs after handler. Use for cleanup. (Cobra's PostRunE)
  postRun: async (args) => {},
});
```

The factory wraps every handler in a try/catch that distinguishes `UserError` (clean message + exit 1) from unexpected errors (stack trace in verbose mode + exit 2).

### `defineNamespace(command, describe, subcommands)`

Groups subcommands under a parent. Equivalent to a Cobra command that only calls `cmd.Usage()`.

```typescript
import { defineNamespace } from "../../core/define-namespace";
import { dbListCommand } from "./list";
import { dbCreateCommand } from "./create";

export const dbNamespace = defineNamespace("db", "Manage databases.", [
  dbListCommand,
  dbCreateCommand,
]);
```

Namespaces automatically enforce `demandCommand(1)` so that running `bunny db` without a subcommand shows help.

---

## Global Flags

Registered on the root yargs instance in `cli.ts` with `global: true` (equivalent to Cobra's `PersistentFlags()`). Available to every command handler via the args object.

| Flag        | Alias | Type      | Default     | Description                                               |
| ----------- | ----- | --------- | ----------- | --------------------------------------------------------- |
| `--profile` | `-p`  | `string`  | `"default"` | Configuration profile to use                              |
| `--verbose` | `-v`  | `boolean` | `false`     | Enable verbose/debug output                               |
| `--output`  | `-o`  | `string`  | `"text"`    | Output format: `text`, `json`, `table`, `csv`, `markdown` |
| `--api-key` |       | `string`  |             | API key (takes priority over profile and environment)     |

### Yargs behavior flags

These are configured on the root yargs instance:

- **`$0` default command** — Running `bunny` with no subcommand shows a branded landing page (ASCII art, commands list, examples, global options).
- **`recommendCommands()`** — "Did you mean ...?" suggestions on typos (like Cobra).
- **`strict()`** — Errors on unrecognized flags.
- **`.version()`** — Reads from `package.json`.
- **`.help()`** — Auto-generated help for all commands.

---

## Configuration System

### Config file format

A single JSON file stores profiles and settings. This matches the existing Go CLI format for backward compatibility.

```json
{
  "log_level": "info",
  "profiles": {
    "default": {
      "api_key": "bny_xxxxxxxxxxxx",
      "api_url": "https://api.bunny.net"
    },
    "staging": {
      "api_key": "bny_test_xxxxxxx",
      "api_url": "https://staging-api.bunny.net"
    }
  }
}
```

### Schema

Defined in `packages/cli/src/config/schema.ts` using Zod:

```typescript
const ProfileSchema = z.object({
  api_key: z.string(),
  api_url: z.string().optional(), // defaults to https://api.bunny.net
});

const ConfigFileSchema = z.object({
  log_level: z.string().optional(),
  profiles: z.record(z.string(), ProfileSchema).default({}),
});
```

### Config file resolution

Searches in order (first match wins), matching the Go CLI's `getFileCandidates()`:

1. `$XDG_CONFIG_HOME/bunnynet.json`
2. `~/.config/bunnynet.json`
3. `~/.bunnynet.json`
4. `/etc/bunnynet.json`

When writing a new config, the CLI uses the first existing file path, or falls back to the first candidate (`$XDG_CONFIG_HOME` or `~/.config/bunnynet.json`).

Config files are written with permissions `0o660`.

### Config resolution precedence

When resolving the active configuration (in `resolveConfig(profile, apiKeyOverride?, verbose?)`), the following priority applies — highest wins:

1. **`--api-key` flag** — Passed as `apiKeyOverride` to `resolveConfig()`
2. **Environment variables** — `BUNNYNET_API_KEY` and `BUNNYNET_API_URL`
3. **Config file profile** — Matched by the `--profile` flag value
4. **Built-in defaults** — `apiUrl: "https://api.bunny.net"`, empty `apiKey`

If `--api-key` or `BUNNYNET_API_KEY` is set, the config file is ignored entirely and the profile field is set to `""`.

If the requested profile does not exist and is not `"default"`, `resolveConfig()` throws an error.

### Environment variables

| Variable                 | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `BUNNYNET_API_KEY`       | API key. Overrides any profile-based key.                                  |
| `BUNNYNET_API_URL`       | API base URL. Defaults to `https://api.bunny.net`.                         |
| `BUNNYNET_DASHBOARD_URL` | Dashboard URL for browser auth flow. Defaults to `https://dash.bunny.net`. |
| `NO_COLOR`               | Disable colored output (see [no-color.org](https://no-color.org)).         |

---

## Authentication

### Browser login flow (`bunny login`)

This is an browser-based auth flow using a local HTTP callback server. It is a direct port of the Go CLI's implementation.

**Flow:**

1. Generate a random 16-byte hex state token (CSRF protection).
2. Start a local HTTP server on a random port (`Bun.serve({ port: 0 })`).
3. Construct the auth URL: `{DASHBOARD_URL}/auth/login?source=cli&domain=localhost&callbackUrl={encodedCallbackUrl}`.
4. Open the URL in the user's default browser via `Bun.spawn()` (platform-detected: `open` on macOS, `xdg-open` on Linux, `rundll32` on Windows).
5. Print the URL to the terminal as a fallback.
6. Wait for the callback with a 5-minute timeout.
7. On callback, validate the state parameter and extract the `apiKey` query param.
8. Serve an embedded HTML success page to the browser.
9. Save the API key to the profile via `setProfile()`.
10. Shut down the local server.

**Error cases:**

- State mismatch → reject with CSRF error.
- Missing apiKey in callback → reject.
- 5-minute timeout → exit with timeout error.
- Profile already exists → prompt for confirmation (bypass with `--force`).

**Success page:**

An HTML page is embedded as a template literal string in `login.ts` (equivalent to Go's `//go:embed success.html`). It shows a card with "Authenticated!" and a message to close the tab. Styled with the bunny.net brand gradient (`#e1f2ff → #fff`).

### Logout flow (`bunny logout`)

1. Check that the profile exists via `profileExists()`. If not, throw `UserError`.
2. Prompt for confirmation (bypass with `--force`).
3. Delete the profile via `deleteProfile()`.

### Profile management

- **`bunny config profile create <name>`** (alias: `add`) — Prompts for API key with masked input, saves to config file.
- **`bunny config profile delete <name>`** — Removes profile from config file.
- **`bunny config init`** — Convenience command that delegates to profile create for the active profile.
- **`bunny config show`** — Displays resolved config as a table (or JSON with `--output json`). API key is truncated in table view.

---

## UI Helpers

Defined in `packages/cli/src/core/ui.ts`. These wrap third-party libraries with consistent behavior.

### `readPassword(message: string): Promise<string>`

Masked password input using `prompts` with `type: "password"`. Used for API key entry.

### `confirm(message: string, opts?: { force?: boolean }): Promise<boolean>`

Confirmation prompt using `prompts` with `type: "confirm"`. If `opts.force` is `true`, returns `true` immediately without prompting. This maps to the `--force` flag pattern used in `auth login` and `auth logout`.

### `requireConfirmable(output, { force, message, hint })`

Guard called immediately before a `confirm()`/`confirmTyped()` that gates a destructive action. Returns silently with `force`, or when `isInteractive(output)`; otherwise throws a `UserError` with `hint`. Without it an unattended run (CI, `--output json`, no TTY) blocks forever on a prompt nobody can answer, and the prompt lands on stdout ahead of the JSON payload. Used by `sites delete`, `sites deployments publish/prune`, and the shared `domains remove`.

### `spinner(text: string): ora.Ora`

Creates an `ora` spinner. Automatically silenced in non-TTY environments (`isSilent: !process.stdout.isTTY`).

---

## Error Handling

### Error classes

- **`UserError`** — Expected errors caused by user input or missing configuration. Displayed as a clean message with an optional hint. Exit code 1.
- **`ConfigError`** — Extends `UserError`. Automatically includes a hint to run `bunny config show`.
- **`ApiError`** — Extends `UserError`. Thrown by the API middleware for HTTP error responses. Carries `status`, optional `field`, and optional `validationErrors[]`.

### API error normalization

The bunny.net APIs use two different error response formats. The shared `authMiddleware()` in `packages/openapi-client/src/middleware.ts` normalizes both into `ApiError` via an `onResponse` handler, so command code never deals with raw HTTP errors.

| API              | Error schema              | Fields                                                                              |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| Core + Compute   | `ApiErrorData`            | `ErrorKey`, `Field`, `Message` (all optional, nullable)                             |
| Magic Containers | `ErrorDetails` (RFC 7807) | `title`, `status`, `detail`, `instance`, `errors[]` (with nested `ValidationError`) |

The middleware detects the shape and maps it:

- **RFC 7807** (`title`/`detail`) → `ApiError(detail \|\| title, status, undefined, errors)`
- **ApiErrorData** (`Message`) → `ApiError(Message, status, Field)`
- **Empty body** (Core/Compute 401/404/500) → `ApiError` with a sensible default message per status code

### Error flow

The `defineCommand()` factory wraps every handler:

```
try {
  preRun() → handler() → postRun()
} catch (err) {
  if --output json → JSON error payload to stdout, exit 1 or 2
  if ApiError with validationErrors → log message + each field error, exit 1
  if UserError  → log error message + hint, exit 1
  if unexpected → log "An unexpected error occurred", show stack trace if --verbose, exit 2
}
```

With `--output json`, error payloads include all available context:

```json
{
  "error": "Validation failed.",
  "status": 400,
  "field": "Name",
  "validationErrors": [
    {
      "field": "Name",
      "message": "Name is required."
    }
  ]
}
```

### Exit codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | Success                                           |
| 1    | User error (bad input, missing config, API error) |
| 2    | Unexpected/internal error                         |

---

## Logger

Defined in `packages/cli/src/core/logger.ts`. Uses `chalk` for styling.

| Method                       | Prefix           | Use                                 |
| ---------------------------- | ---------------- | ----------------------------------- |
| `logger.info(msg)`           | `ℹ` (blue)       | Informational messages              |
| `logger.success(msg)`        | `✓` (green)      | Successful operations               |
| `logger.warn(msg)`           | `⚠` (yellow)     | Warnings                            |
| `logger.error(msg)`          | `✖` (red)        | Errors                              |
| `logger.dim(msg)`            | — (gray)         | Hints, secondary info               |
| `logger.debug(msg, verbose)` | `[debug]` (gray) | Only shown when `verbose` is `true` |

### NO_COLOR support

The CLI respects the [NO_COLOR](https://no-color.org) standard. When `NO_COLOR` is set (any non-empty value), all ANSI color codes are suppressed:

- **chalk** — Natively respects `NO_COLOR` by setting `chalk.level` to `0`.
- **cli-table3** — Has its own built-in ANSI coloring for headers and borders. Disabled by passing `style: { head: [], border: [] }` when `chalk.level === 0`. This is handled in `format.ts` and `shell.ts`.
- **ora** — Uses chalk internally, so spinners are also affected.

---

## Output Format System

Defined in `packages/cli/src/core/format.ts`. Provides shared rendering for tabular and key-value data across all output formats.

### `OutputFormat` type

```typescript
type OutputFormat = "text" | "json" | "table" | "csv" | "markdown";
```

### Core functions

| Function                             | Purpose                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `formatTable(headers, rows, format)` | Render tabular data. Handles `text`, `table`, `csv`, `markdown`. |
| `formatKeyValue(entries, format)`    | Render key-value pairs as a 2-column table via `formatTable`.    |
| `csvEscape(value)`                   | Escape a value for CSV (handles commas, quotes, newlines).       |

### Format behavior

| Format     | Renderer                                  | Notes                                |
| ---------- | ----------------------------------------- | ------------------------------------ |
| `text`     | Borderless `cli-table3` with bold headers | Default human-friendly output        |
| `table`    | Bordered `cli-table3`                     | Standard box-drawing table           |
| `csv`      | String concatenation with `csvEscape()`   | Header row + data rows               |
| `markdown` | String concatenation with pipe escaping   | GFM pipe tables                      |
| `json`     | Not handled by format functions           | Each command serializes its own JSON |

Commands should handle `json` first (early return), then pass `output` to `formatTable` or `formatKeyValue` for all other formats.

---

## Build & Distribution

### Development

```bash
bun run packages/cli/src/index.ts <command>     # Run directly
bun --watch packages/cli/src/index.ts           # Watch mode
bun link                           # Make `bunny` globally available
bun test                           # Run tests
tsc --noEmit                       # Type-check only
```

### Production build

```bash
bun build packages/cli/src/index.ts --compile --outfile bunny
```

Produces a single native executable containing the Bun runtime, all npm dependencies, and all source code. No runtime dependencies required on the target machine.

### Cross-compilation

```bash
bun build packages/cli/src/index.ts --compile --target=bun-linux-x64 --outfile bunny-linux-x64
bun build packages/cli/src/index.ts --compile --target=bun-linux-arm64 --outfile bunny-linux-arm64
bun build packages/cli/src/index.ts --compile --target=bun-darwin-x64 --outfile bunny-darwin-x64
bun build packages/cli/src/index.ts --compile --target=bun-darwin-arm64 --outfile bunny-darwin-arm64
bun build packages/cli/src/index.ts --compile --target=bun-windows-x64 --outfile bunny-windows-x64.exe
```

### Distribution

The CLI is distributed through three channels:

**1. Shell installer (standalone binary)**

```bash
curl -fsSL https://cli.bunny.net/install.sh | sh
```

Downloads the prebuilt binary for the current platform from GitHub Releases and installs to `~/.bunny/bin`. Supports `BUNNY_INSTALL_DIR` env var for custom paths (e.g. `BUNNY_INSTALL_DIR=/usr/local/bin`). On macOS the script clears the quarantine xattr and ad-hoc codesigns the binary so Gatekeeper allows execution. Uses GitHub's `releases/latest/download` redirect to avoid the api.github.com rate limit. Script is at `install.sh` in the repo root.

**2. npm (platform-specific binary packages)**

```bash
npm install -g @bunny.net/cli
```

Uses the platform-specific package pattern (like esbuild/turbo). The main `@bunny.net/cli` package contains a JS shim (`packages/cli/bin/bunny.js`) that delegates to the correct platform binary. Platform packages:

| Package                       | Platform                    |
| ----------------------------- | --------------------------- |
| `@bunny.net/cli-linux-x64`    | Linux x64                   |
| `@bunny.net/cli-linux-arm64`  | Linux arm64                 |
| `@bunny.net/cli-darwin-x64`   | macOS x64                   |
| `@bunny.net/cli-darwin-arm64` | macOS arm64 (Apple Silicon) |
| `@bunny.net/cli-windows-x64`  | Windows x64                 |

Platform packages live in `packages/` alongside the other workspace packages. They are versioned in lockstep with `@bunny.net/cli` via the `fixed` array in `.changeset/config.json`. They contain only a `package.json` and the compiled binary, published by CI.

**3. GitHub Releases**

Each release includes prebuilt binaries as release assets, created automatically by `.github/workflows/release.yml`.

### Release workflow

1. Create changesets on feature branches (`bun run changeset`)
2. Merge to `main` — the `changesets/action` opens or updates a "Release" PR
3. Merge the Release PR — changesets bumps versions for `@bunny.net/cli` and all platform packages (kept in sync via `fixed`)
4. The release workflow detects the version change, builds binaries for all platforms, publishes platform packages then `@bunny.net/cli` to npm, and creates a GitHub release with binaries attached

### Publishing `@bunny.net/openapi-client`

Unlike the CLI and `database-shell` (which ship as compiled binaries), `@bunny.net/openapi-client` is published as a plain TypeScript library — compiled JS plus `.d.ts` declarations.

Its `package.json` `exports`/`main`/`types` point at `dist/`, so npm consumers get the compiled output. **In-repo tooling resolves it from source instead** — the root `tsconfig.json` has a `paths` mapping for `@bunny.net/openapi-client` → `src/`, and `bun run`, `bun build --compile`, `bun test`, and `tsc` all honor `paths` over the package's `exports`. So the CLI build and dev loop consume live source with no prebuild step, while only the publish step needs `dist/` built. (Published consumers never see the repo `tsconfig.json`, so they fall back to `exports`.)

- `bun run --filter @bunny.net/openapi-client build` runs `generate` (the `src/generated/` types are gitignored, so they are regenerated from the committed specs), then `scripts/build.ts`.
- `scripts/build.ts` drives the TypeScript compiler API (using `tsconfig.build.json`) to emit JS + declarations, then copies the generated `.d.ts` files into `dist/generated/` (tsc never emits its inputs, and those files back the `./generated/*` subpath export). `rewriteRelativeImportExtensions` rewrites `./x.ts` → `./x.js` in the emitted **JS**; TypeScript has no equivalent for declaration emit, so an `afterDeclarations` transformer rewrites the `.ts`/`.d.ts` specifiers in the emitted **`.d.ts`** files on the AST.
- The `publish-openapi-client` job in `release.yml` (gated on a version bump detected via `npm view`) builds, then runs `cd packages/openapi-client && npm publish` (`files` ships `dist` + `README.md` + `LICENSE`). The package versions independently of the CLI — it is not part of any `fixed` group in `.changeset/config.json`.

### Publishing `@bunny.net/sandbox`

`@bunny.net/sandbox` follows the same compiled-library pattern as `@bunny.net/openapi-client`: `exports`/`main`/`types` point at `dist/`, in-repo tooling resolves it from source via the root `tsconfig.json` `paths` mapping, and `tsconfig.build.json` (plain `tsc` with `rewriteRelativeImportExtensions`, no `scripts/build.ts`) emits JS + declarations. Unlike openapi-client it has no declaration transformer, so emitted `.d.ts` keep their `.ts` import specifiers, which TypeScript resolves to the sibling `.d.ts` at the consumer.

Two differences from openapi-client:

- Sandbox depends on `@bunny.net/openapi-client` with `workspace:*`, so the `publish-sandbox` job in `release.yml` uses `bun publish` (not `npm publish`) — bun rewrites `workspace:*` to the local package version in the published tarball; npm would ship the unresolvable `workspace:*` spec verbatim. `bun publish` authenticates via the `NPM_CONFIG_TOKEN` env var.
- Its `tsconfig.build.json` overrides `paths` to `{}` so openapi-client resolves via its package `exports` (`dist/`) instead of source — otherwise openapi-client's sources would enter the program and violate `rootDir`. The publish job therefore builds openapi-client before building sandbox.

`@bunny.net/config` is a private workspace package (not published); the CLI consumes it from source via the workspace symlink.

### CI

Tests and type-checking run on every pull request via `.github/workflows/ci.yml` (`bun run typecheck` and `bun test`).

---

## Command Reference

```
bunny
├── login              [--force]            Authenticate via browser
├── logout             [--force]            Remove stored authentication profile
├── whoami                                  Show authenticated account (name, email, account id, profile)
├── config
│   ├── init            [--api-key]         Initialize config (create default profile)
│   ├── show                                Display resolved configuration
│   └── profile
│       ├── create <name>  (alias: add)     Create a named profile with API key
│       └── delete <name>                   Delete a named profile
├── apps                                    (experimental — hidden from help and landing page)
│   ├── init            [image] [--name] [--dockerfile] [--registry] [--port] [--command] [--config]
│   │                                       Scaffold bunny.jsonc via shared walkthrough (no deploy); --config writes to a specific path
│   ├── list            (alias: ls)         List all apps
│   ├── show            [--id]              Show app details and overview
│   ├── deploy          [image] [--name] [--dockerfile] [--context] [--tag] [--registry] [--container] [--port] [--command] [--config] [--dry-run] [--no-push]
│   │                                       Deploy a pre-built image, build from a Dockerfile, or re-deploy from bunny.jsonc.
│   │                                       First-run, in order: imports compose.yml if present, else scans for Dockerfiles (monorepo subdirs included) and lets the user pick one or many (each becomes a container) plus an "add another" loop for manual paths, else falls back to a pre-built image.
│   │                                       --config <path> uses that file as the source of truth (CI / agent flows); --dry-run skips writes and API.
│   ├── undeploy        [--id] [--force]    Undeploy an app
│   ├── restart         [--id]              Restart an app
│   ├── delete          [--id] [--force]    Delete an app (drops the manifest if it pointed at this app)
│   ├── link            [app-id] [--force]  Link this directory to an existing app (omit ID for interactive selection; writes .bunny/app.json)
│   ├── unlink          [--force]           Remove .bunny/app.json
│   ├── pull            [--id] [--force]    Sync remote config to bunny.jsonc + .bunny/app.json
│   ├── push            [--id] [--dry-run]  Apply bunny.jsonc to remote (uses .bunny/app.json for registry IDs)
│   ├── env
│   │   ├── list        [--container]       List environment variables
│   │   ├── set         <key> <value> [--container]  Set environment variable
│   │   ├── remove      <key> [--container] Remove environment variable
│   │   ├── pull        [--container] [--force]      Pull env vars to .env
│   │   └── push        [file] [--container] [--replace] [--dry-run]
│   │                                       Bulk import a .env file (merge by default; --replace drops vars not in file)
│   ├── endpoints
│   │   ├── list        [--container]       List endpoints
│   │   ├── add         [--container] [--type] [--ssl]  Add endpoint
│   │   └── remove      <id> [--force]      Remove endpoint
│   ├── volumes
│   │   ├── list                            List volumes
│   │   └── remove      <id> [--force]      Remove volume
│   └── regions
│       ├── list        (alias: ls)         List available regions
│       └── show        [id]                Show app region settings
├── registries                              List container registries (default: list)
│   ├── list            (alias: ls)         List container registries
│   ├── add             [--name] [--username]  Add registry
│   ├── update          <id> [--name] [--username] [--password]
│   │                                       Update registry name and/or rotate credentials
│   └── remove          <id>                Remove registry
├── dns                                     Manage DNS zones and records
│   │                                       Two resource groups: `records` (entries in a zone) and `zones` (the zone itself).
│   │                                       Every [domain] is optional — omit it to use the linked zone (`dns zones link` → .bunny/dns.json), else pick interactively (resolveZoneInteractive; errors instead of prompting under --output json or without a TTY). Picking a zone interactively offers to link the directory (`zones remove` never offers).
│   ├── records                             (canonical; aliases: record, rec)
│   │   ├── list        [domain] (alias: ls)  List the records within a zone
│   │   ├── add         [domain] [name] [type] [values..] [--ttl] [--comment] [--pull-zone] [--script]
│   │   │                                   Add a DNS record (interactive wizard when args omitted; MX/SRV/CAA use positional values; PullZone/Script use --pull-zone/--script)
│   │   ├── update      [domain] [id] [--name] [--value] [--type] [--ttl] [--priority] [--weight] [--port] [--flags] [--tag] [--comment] [--disabled] [--pull-zone] [--script]
│   │   │                                   Update a DNS record (alias: edit; prompts to pick zone+record when omitted)
│   │   ├── remove      [domain] [id] [--force]  Remove a DNS record (alias: rm; prompts to pick zone+record when omitted)
│   │   ├── preset      [name] [domain] [--param key=value]  Apply a preset record set (`preset list` lists; email providers, verification, security; --param repeatable for non-interactive runs)
│   │   ├── scan        [domain] [--yes]    Scan for the domain's existing records (bunny server-side scan) and import them (--yes skips the confirm)
│   │   ├── import      [domain] [file]     Import records from a BIND zone file (prompts for zone/file when omitted)
│   │   └── export      [domain] [--file] [--save]  Export a zone as a BIND zone file (stdout, --file <path>, or --save → <domain>.zone)
│   └── zones                               (canonical; aliases: zone; hidden: domain, domains)
│       ├── list                            List all DNS zones (alias: ls)
│       ├── add         [domain] [--import]  Create a DNS zone (prompts for the domain when omitted): with a TTY, prompt how to add records (scan for existing records / upload a zone file / add records manually / continue); then print the bunny nameservers to set (naming the registrar via RDAP when detectable). --import scans and imports all existing records without prompting (also under --output json, surfacing failures); --no-import (and non-TTY default) skips the menu
│       ├── link        [domain]            Link this directory to a zone → .bunny/dns.json (pick interactively when omitted)
│       ├── unlink      [--force]           Remove .bunny/dns.json, unlinking this directory
│       ├── show        [domain]            Show zone details (nameservers, SOA, DNSSEC, logging, record count)
│       ├── remove      [domain] [--force]  Delete a DNS zone and its records (alias: rm)
│       ├── stats       [domain] [--from] [--to]  Show DNS query statistics for a zone (defaults to last 30 days; text mode renders a bar chart)
│       ├── nameservers [domain] (alias: ns)  Live-check whether the registrar delegates to bunny.net; confirm on success, else show the nameservers to set at the named registrar
│       ├── dnssec
│       │   ├── enable  [domain]            Enable DNSSEC and print the DS record for the registrar
│       │   └── disable [domain] [--force]  Disable DNSSEC
│       └── logging
│           ├── enable  [domain] [--anonymize-ip] [--anonymization onedigit|drop]
│           │                               Enable DNS query logging
│           └── disable [domain] [--force]  Disable DNS query logging
├── storage                                 (experimental, hidden from help and landing page)
│   │                                       Two resource groups: `zones` (the zone, via core API + account key) and `files` (zone contents, via @bunny.net/storage-sdk + the zone password/region host, resolved automatically). The zone is a name or numeric ID; `zones` commands take it as the `[zone]` positional, `files` commands as the `--zone`/`-z` flag (the positional is the file/path). When the zone is omitted it resolves from a linked zone (`bunny storage link`) then an interactive picker (errors instead of prompting under --output json, no TTY, or --force), which offers to link the directory to the picked zone (except on destructive commands).
│   ├── zones                               (canonical; aliases: zone; hidden: bucket, buckets)
│   │   ├── list                            List all storage zones (alias: ls)
│   │   ├── add         [name] [--region] [--replication] [--pull-zone] [--pull-zone-name] [--domain] [--force/-f]  Create a storage zone (prompts for name + region when omitted; offers/--pull-zone creates a pull zone to serve it on the web, then offers/--domain a custom domain via setupHostname; replicas are permanent so adding any is confirmed; --force/--output json skip all prompts and use flag values only)
│   │   ├── show        [zone]              Show zone details (region, replication, hostname, usage)
│   │   ├── update      [zone] [--custom-404-path] [--rewrite-404-to-200] [--replication] [--force/-f]  Update zone settings (edits interactively pre-filled when no flags; replication is additive and adding a replica is confirmed unless --force; --force/--output json/non-TTY require flags and error "No changes requested." without them)
│   │   ├── remove      [zone] [--force]    Delete a storage zone and its files (alias: rm); double confirmation (yes/no + type the zone name) unless --force; cleans up a stale .bunny/storage.json
│   │   ├── credentials [zone] [--format rclone|aws|s3cmd|env] [--read-only] [--show-secret]  (alias: creds)
│   │   │                                   S3 credentials for the zone (name = access key, password = secret); --format emits tool config, else table/--output json; table and JSON mask the secret unless --show-secret
│   │   └── domains                         (canonical; alias: hostnames) custom domains on the zone's pull zone; mounts core/hostnames createHostnamesCommands; resolver maps the storage zone (positional, else linked zone, else picker) to its linked pull zone
│   ├── files                               (canonical; aliases: file) [--zone|-z] defaults to the linked zone on every file command
│   │   ├── list        [path] [--zone] (alias: ls)  List files in a directory (trailing slash on path)
│   │   ├── upload      <file> [--zone] [--to] [--checksum] [--content-type]  Upload a local file
│   │   ├── download    <path> [--zone] [--out]  Download a file
│   │   └── remove      <path> [--zone] [--force] (alias: rm)  Delete a file or directory (trailing slash = recursive)
│   ├── link            [zone]              Link the current directory to a storage zone (.bunny/storage.json); interactive picker when omitted
│   ├── unlink          [--force/-f]        Remove .bunny/storage.json, unlinking this directory (confirmation unless --force)
│   ├── regions                             List available storage regions (replication uses the same set minus the primary)
│   └── docs                                Open storage documentation in browser
├── db
│   ├── create          [--name] [--primary] [--replicas] [--storage-region]
│   │                                       Create a new database
│   ├── delete          [database-id] [--force]
│   │                                       Delete a database
│   ├── docs                                Open database documentation in browser
│   ├── list            (alias: ls) [--group-id]
│   │                                       List all databases
│   ├── quickstart      [database-id] [--lang] [--url] [--token]
│   │                                       Generate quickstart guide for a database
│   ├── regions
│   │   ├── add         [database-id] [--primary] [--replicas]
│   │   │                                   Add primary/replica regions
│   │   ├── list        [database-id]       List configured regions
│   │   ├── remove      [database-id] [--primary] [--replicas]
│   │   │                                   Remove primary/replica regions
│   │   └── update      [database-id]       Interactive region toggle
│   ├── shell           [database-id] [query] [-e] [-m] [--unmask] [--url] [--token]
│   │                                       Interactive SQL shell with dot-commands
│   ├── show            [database-id]       Show database details
│   ├── usage           [database-id] [--period] [--from] [--to]
│   │                                       Show database usage statistics
│   └── tokens
│       ├── create      [database-id] [--read-only] [--expiry]
│       │                                   Generate an auth token
│       └── invalidate  [database-id] [--force]   Invalidate all tokens for a database
├── scripts
│   ├── init            [--name] [--type] [--template] [--github-actions] [--deploy] [--skip-git] [--skip-install]
│   │                                       Create a new Edge Script project from a template
│   ├── create          [name] [--type] [--pull-zone] [--pull-zone-name] [--link] [--domain]
│   │                                       Create a remote Edge Script (use after init when --deploy was skipped)
│   ├── deploy          <file> [id] [--skip-publish]
│   │                                       Deploy code to an Edge Script (publishes by default)
│   ├── delete          [id] [--force]      Delete an Edge Script (double confirmation or --force)
│   ├── deployments
│   │   ├── list        [id] (alias: ls)    List deployments for an Edge Script
│   │   └── publish     <release> [id] [--force]
│   │                                       Publish (roll back to) a past deployment by release ID
│   ├── docs                                Open Edge Script documentation in browser
│   ├── domains                             (hidden alias: hostnames)
│   │   ├── add         <domain> [id] [--ssl] [--wait] [--no-force-ssl] [--pull-zone]
│   │   │                                   Add a custom domain (SSL opt-in; HTTPS forced by default; --wait polls DNS then issues SSL)
│   │   ├── ssl         <domain> [id] [--no-force-ssl] [--pull-zone]
│   │   │                                   Issue a free SSL certificate (HTTPS forced by default)
│   │   ├── list        [id] (alias: ls) [--pull-zone]   List pull zone domains
│   │   └── remove      <domain> [id] (alias: rm) [--force] [--pull-zone]
│   │                                       Remove a custom domain (script [id] also accepted as --id on all domains subcommands)
│   ├── env
│   │   ├── list        [id]                List environment variables
│   │   ├── set         <key> <value> [id]  Set environment variable
│   │   ├── remove      <key> [id]          Remove environment variable
│   │   └── pull        [id] [--force]      Pull env vars to .env file
│   ├── link            [--id]              Link directory to a remote Edge Script
│   ├── list            (alias: ls)         List all Edge Scripts
│   ├── show            [id]                Show Edge Script details (uses linked script if omitted)
│   └── stats           [id] [--from] [--to] [--hourly] [--link]
│                                           Show usage statistics (requests/CPU/cost totals + bar chart; defaults to last 30 days). No ID → linked script → interactive picker (offers to link; --no-link skips). JSON output skips the picker and errors.
├── sites                                   Manage sites.
│   │                                       Static-site hosting: one storage zone (files) + one pull zone (CDN) + one middleware router script per site. Zone names are `sites-{name}-{random suffix}` (prefixed for dashboard grouping; suffixed because zone names are global across bunny.net); the site keeps its clean name in state. Deploys are immutable directories (`deploys/{id}/`); promote/rollback flips the router's CURRENT_DEPLOY env var + purges the cache; no files move. Every deploy gets its own preview pull zone (`sites-dpl-{id}-{rand6}`, served at that name under b-cdn.net with instant HTTPS): same storage origin, same router, root-served, so client-side routers behave exactly like production and no custom domain or DNS setup is needed. Publishing is always explicit (--production, or the interactive first-deploy offer). Custom domains are production-only vanity hostnames. Site state lives at `_bunny/site.json` in the storage zone (403-blocked by the router); `.bunny/site.json` is the local pointer. Site resolution everywhere: explicit ref → .bunny/site.json → `sites.name` in bunny.jsonc → interactive picker (offers to link). The picker is skipped, with an error, under `--output json`/no TTY and on destructive commands run with `--force`.
│   ├── create          [name] [--region] [--domain] [--link]
│   │                                       Provision a site (idempotent; a failed create re-runs cleanly; each resource is looked up by name first). A missing name comes from `sites.name` in bunny.jsonc (reported in text output), else interactive runs prompt for one (directory-name suggestion). --domain attaches a custom production domain; when omitted, interactive runs offer to add one (Bunny DNS record with confirmation, nameserver guidance when undelegated, DNS wait + SSL). GitHub repos then get an offer to scaffold the deploy workflow (declining prints it instead).
│   ├── list            (alias: ls)         List sites (middleware+storage pull zones with matching remote state)
│   ├── show            [site] [--link]     Show resources, domains (with SSL + Force SSL state), current deploy; warns when a newer router is available
│   ├── open            [site] [--print]    Open the live URL (recorded custom domain when live, else system host) in the browser; --print emits it
│   ├── deploy          [dir] [--site] [--link] [--build [cmd]] [--env K=V] [--env-file] [--production/--prod] [--force]
│   │                                       Deploy a directory: git short-sha ID when the tree is clean, content hash otherwise; identical IDs are no-ops (an already-uploaded ID skips the upload and just publishes). Every deploy gets an immutable `sites-dpl-{id}-{rand6}.b-cdn.net` preview URL; --production/--prod publishes it as the live site (a fresh site's interactive first deploy offers this, since nothing is live yet). The target site resolves via selectSite (--site → linked → bunny.jsonc → picker); when nothing is linked, the interactive picker offers to create a new site (or, with no sites yet, goes straight to create) and links it. A [dir] arg is cwd-relative; without it the target is `sites.dir` (or the detected output dir), resolved against the bunny.jsonc directory where the build runs, else that directory (dotfiles + node_modules excluded). --build runs the command (or `sites.build`, else the detected build; resolved before any site is created so a missing command can't leave an orphan site) in the caller's environment plus --env/--env-file overrides. Without --build, an interactive run offers to run the configured `sites.build`, else a detected build (the CI framework preset's command, else a package.json `build` script); confirming builds first and, when no dir was given, deploys the framework's output dir.
│   ├── deployments
│   │   ├── list        [site] [--link] (alias: ls)  List deploys (● Live / ○ Previous markers, created, source, files, size)
│   │   ├── publish     [id] [--previous] [--site] [--link] [--force]  (alias: promote)
│   │   │                                   Promote a past deploy; instant rollback (--previous = the previous deploy). Unattended runs need --force (the confirmation is guarded by requireConfirmable)
│   │   └── prune       [site] [--keep N] [--force]  Delete old deploys (never current/previous; default keeps 5). --keep is validated as a whole number >= 0 before anything runs (resolveKeepCount: yargs turns `--keep abc` into NaN, which would otherwise slip through pruneVictims and prune everything). Unattended runs need --force; "nothing to prune" still succeeds without it
│   ├── domains                             (hidden alias: hostnames); mounts core/hostnames createHostnamesCommands with a sites resolver
│   │   ├── add         <domain> [site] [--ssl] [--wait] [--no-force-ssl]  Add a custom production domain; the first one is recorded in site state as the production URL (display only; previews are independent). Re-running on an already-attached domain reconciles the remaining steps instead of failing, so it's the retry for any partial setup
│   │   ├── ssl         <domain> [site]     Issue a free SSL certificate
│   │   ├── list        [site] (alias: ls)  List domains
│   │   └── remove      <domain> [site] [--force]  Remove a domain (clears state.domain, onRemoved hook)
│   ├── ssl             [site] [--no-force-ssl]  Toggle Force HTTPS on the site's b-cdn.net system host (no cert issued; custom domains use `sites domains ssl`)
│   ├── ci
│   │   └── init        [--site] [--link] [--framework] [--force]  Write .github/workflows/bunny-sites.yml at the git root: `sites.dir`/`sites.build` from bunny.jsonc override the preset's directory and build command (so CI deploys what `sites deploy` does), and a bunny.jsonc below the git root sets the job's working directory + prefixes the deploy directory; else framework detection (package.json deps, Gemfile, hugo/python/zola config files; lockfile picks the package manager), via BunnyWay/actions/deploy-site: previews on PRs + production on merges to main (previews need no custom domain, so there is a single workflow shape), offers `gh secret set BUNNY_API_KEY`
│   ├── link            [site]              Link this directory to a site → .bunny/site.json
│   ├── unlink                              Remove .bunny/site.json
│   ├── upgrade-router  [site] [--link]     Republish the site's router script with the CLI's current source
│   └── delete          [site] [--force] [--keep-storage]  Delete pull zone → router → storage zone (typed-name confirmation, so unattended runs need --force; best-effort so re-runs finish a partial delete)
├── skills
│   └── install         (alias: add) [--global]  Install the bunny agent skill: marked AGENTS.md block + .claude/skills/bunny-cli/ when the project uses Claude Code; --global writes ~/.claude/skills/bunny-cli/ for every project
├── docs                                    Open bunny.net documentation in browser
├── open               [--print]            Open bunny.net dashboard in browser (or print URL)
├── --profile, -p       <string>            Profile to use (default: "default")
├── --verbose, -v       <boolean>           Enable verbose output
├── --output, -o        <text|json|table|csv|markdown>  Output format (default: "text")
├── --api-key           <string>            API key (takes priority over profile and env)
├── --version                               Show version
└── --help                                  Show help
```

---

## API Clients

### Overview

API calls use `openapi-fetch` with types generated from OpenAPI specs by `openapi-typescript`. This gives full type safety — paths, params, request bodies, and responses are all inferred from the specs.

### API domains

| Client                   | Factory                      | Base URL                               | Auth                   |
| ------------------------ | ---------------------------- | -------------------------------------- | ---------------------- |
| Core API                 | `createCoreClient()`         | `https://api.bunny.net`                | Account `AccessKey`    |
| Edge Scripting (Compute) | `createComputeClient()`      | `https://api.bunny.net`                | Account `AccessKey`    |
| Database                 | `createDbClient()`           | `https://api.bunny.net/database`       | Account `AccessKey`    |
| Magic Containers         | `createMcClient()`           | `https://api.bunny.net/mc`             | Account `AccessKey`    |
| Origin Errors            | `createOriginErrorsClient()` | `https://cdn-origin-logging.bunny.net` | Account `AccessKey`    |
| Shield                   | `createShieldClient()`       | `https://api.bunny.net`                | Account `AccessKey`    |
| Storage                  | `createStorageClient()`      | `https://storage.bunnycdn.com`         | Storage Zone password  |
| Stream                   | `createStreamClient()`       | `https://video.bunnycdn.com`           | Stream Library API key |

All clients accept a `ClientOptions` object and inject `AccessKey` and `User-Agent` headers via shared `authMiddleware()` in `packages/openapi-client/src/middleware.ts` (also exported from the package root so external consumers can compose custom `openapi-fetch` clients). Each API additionally has a subpath entrypoint (`@bunny.net/openapi-client/<api>`) re-exporting its factory plus the generated spec types.

### ClientOptions

All client factories accept a single options object:

```typescript
interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  verbose?: boolean;
  userAgent?: string; // defaults to "bunnynet-api"
  onDebug?: (msg: string) => void; // no-op if not provided
}
```

The CLI provides a `clientOptions()` helper (`packages/cli/src/core/client-options.ts`) that builds this from `ResolvedConfig`, injecting the CLI version as `userAgent` and `logger.debug` as `onDebug`.

### Undocumented endpoints (`CustomPaths`)

Some bunny.net API endpoints are not included in the public OpenAPI specs. These are typed manually via a `CustomPaths` type in `packages/openapi-client/src/core-client.ts`, which is intersected with the generated `paths`:

```typescript
const client = createClient<paths & CustomPaths>({
  baseUrl,
});
```

Only type the fields you actually use. When the endpoint is added to the spec, remove it from `CustomPaths`.

### Type conventions

Prefer generated schema types over inline primitives. When you need a subset of fields from a generated type, use `Pick<>`:

```typescript
// Good — derived from generated schema
type Database = Pick<components["schemas"]["Database2"], "id" | "name" | "url">;

// Bad — inline primitives that duplicate the schema
type Database = {
  id: string;
  name: string;
  url: string;
};
```

Only fall back to `string`, `any`, or `number` when no generated type exists (e.g. `CustomPaths` for undocumented endpoints).

### OpenAPI specs

Specs are committed as JSON files in `packages/openapi-client/specs/`. Generated types go to `packages/openapi-client/src/generated/` (gitignored). The `redocly.yaml` config and `openapi-typescript` devDependency live in the `@bunny.net/openapi-client` package.

Source URLs are listed at https://bunny.net/docs/openapi; `scripts/update-specs.ts` is the authority for which ones this repo pulls.

| Spec file                                             | Source URL                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/openapi-client/specs/core.json`             | `https://core-api-public-docs.b-cdn.net/docs/v3/public.json`        |
| `packages/openapi-client/specs/compute.json`          | `https://core-api-public-docs.b-cdn.net/docs/v3/compute.json`       |
| `packages/openapi-client/specs/database.json`         | `https://api.bunny.net/database/docs/private/api.json`              |
| `packages/openapi-client/specs/magic-containers.json` | `https://api-mc.opsbunny.net/docs/public/swagger.json`              |
| `packages/openapi-client/specs/origin-errors.json`    | `https://bunny.net/docs/api-reference/origin-errors/openapi.json`   |
| `packages/openapi-client/specs/shield.json`           | `https://api.bunny.net/shield/docs/v1/swagger.json`                 |
| `packages/openapi-client/specs/storage.json`          | `https://bunny.net/docs/api-reference/storage/openapi.json`         |
| `packages/openapi-client/specs/stream.json`           | `https://video.bunnycdn.com/openapi/bunnynet-video-api.public.json` |

To regenerate types after updating specs:

```bash
bun run openapi:generate          # from root (delegates to @bunny.net/openapi-client)
# or
cd packages/openapi-client && bun run generate
```

This reads `packages/openapi-client/redocly.yaml` and outputs `.d.ts` files to `packages/openapi-client/src/generated/`.

### Usage in commands

```typescript
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";

handler: async ({ profile, apiKey, verbose }) => {
  const config = resolveConfig(profile, apiKey, verbose);
  const api = createCoreClient(clientOptions(config, verbose));

  const { data, error } = await api.GET("/pullzone/{id}", {
    params: { path: { id: 12345 } },
  });
};
```

### Adding a new API

1. Add the spec JSON to `packages/openapi-client/specs/`.
2. Add an entry to `packages/openapi-client/redocly.yaml`.
3. Run `bun run openapi:generate`.
4. Create a client factory in `packages/openapi-client/src/` following the existing pattern and export it from `packages/openapi-client/src/index.ts`.
5. Add a per-API entrypoint module (`packages/openapi-client/src/<api>.ts` re-exporting the factory + `export type * from "./generated/<spec>.d.ts"`) and a matching `./<api>` entry in the package `exports` map.

---

## Agent & Scripting Compatibility

The CLI is designed to be fully usable by AI agents, scripts, and pipelines — not just humans.

### Non-interactive by default

Every command must be runnable without interactive prompts when the right flags are provided:

- **Every prompt has a flag equivalent.** If a command prompts for input (API key, confirmation, name), there must be a flag that provides the value and skips the prompt entirely.
  - Confirmation prompts → `--force` flag
  - Text/password input → named flag (e.g. `--api-key`)
- **Never block on stdin.** If a required value is missing and no prompt flag was given, error immediately — don't hang waiting for input that will never come.

Examples of non-interactive usage:

```bash
# Agent sets up auth without any prompts
bunny config init --api-key bny_xxxxxxxxxxxx

# Agent creates a named profile
bunny config profile create staging --api-key bny_xxxxxxxxxxxx

# Agent removes a profile without confirmation
bunny logout --force

# Agent uses a specific API key without login
bunny db list --api-key bny_xxxxxxxxxxxx
```

### Structured JSON output

When `--output json` is set:

- **Success responses** must be valid JSON written to stdout. One JSON object or array per command.
- **Error responses** are also JSON: `{ "error": "message", "hint": "optional" }`. This is handled automatically by `defineCommand()`.
- **No decorative output.** No spinner text, no chalk colors, no tables, no blank lines. Only the JSON payload.
- **Exit codes still apply.** `0` = success, `1` = user error, `2` = unexpected error. Agents check both the JSON and the exit code.

### Conventions for new commands

When adding any command that displays data, always handle `json` separately and use the shared rendering layer for all other formats:

```typescript
import { formatTable, formatKeyValue } from "../../core/format.ts";

handler: async ({ output, profile, apiKey }) => {
  const result = await fetchSomething();

  if (output === "json") {
    logger.log(JSON.stringify(result));
    return;
  }

  // Tabular data — formatTable handles text, table, csv, markdown
  logger.log(formatTable(["Name", "Status"], rows, output));

  // Key-value data — formatKeyValue renders as a 2-column table
  logger.log(formatKeyValue([{ key: "Name", value: "Alice" }], output));
};
```

### Agent skill installer (`bunny skills install`)

So coding agents discover the CLI at all, `bunny skills install` writes the shipped `skills/bunny-cli/` skill into the user's environment. The generic machinery lives in `packages/cli/src/core/agent-skill.ts` so future per-resource skills can reuse it:

- **Project install (default)**: upserts a marked block (`<!-- bunny-cli:start/end -->`) into the project's `AGENTS.md` (created if missing, replaced in place on reinstall; markers are per-skill so multiple blocks coexist). When the project uses Claude Code (`.claude/` or `CLAUDE.md` exists) it also writes the full skill with all references to `.claude/skills/bunny-cli/`.
- **Global install (`--global`)**: writes the skill to `~/.claude/skills/bunny-cli/` so Claude Code picks it up in every project; nothing project-local is touched.
- **Single source of truth**: `packages/cli/src/commands/skills/content.ts` embeds `skills/bunny-cli/**` at bundle time via Bun text imports (`with { type: "text" }`), so the installed skill is always the shipped one; only the compact AGENTS.md section is authored separately. `content.test.ts` fails if SKILL.md routes to a reference that isn't embedded.
- Commands that create project resources can offer this install (via `isProjectSkillInstalled()` + `confirm()`) at natural first-use moments.

---

## Local Context (`.bunny/` Manifest)

### Overview

Commands that operate on a specific remote resource (e.g. a script, an app) can resolve the resource ID from a local context file instead of requiring it as a flag every time. This is similar to `.vercel/project.json`.

### How it works

- **`.bunny/script.json`** (gitignored) — links the current directory to a remote Edge Script.
- **`.bunny/site.json`** (gitignored): links the current directory to a site (the site's storage zone ID). Written by `bunny sites link`/`create`; the site's own state (resource triple, deploys, current/previous) lives remotely at `_bunny/site.json` inside the storage zone, so the local manifest is only a pointer.
- The manifest is machine-managed: written by `bunny scripts link`, read by other script commands.
- `resolveManifestId()` in `packages/cli/src/core/manifest.ts` handles the resolution: explicit ID flag → manifest file → error with hint.
- `findRoot()` walks up the directory tree to find `.bunny/`, so it works from subdirectories.

### Manifest format

```json
{
  "id": 12345,
  "name": "my-script",
  "scriptType": 1
}
```

### Resolution order for resource IDs

Commands that need a resource ID follow this pattern:

1. **Explicit positional or flag** — `bunny scripts show 12345` or `--script-id 12345`
2. **Manifest file** — `.bunny/script.json` in the current or ancestor directory
3. **Error** — `UserError` with a hint to run `bunny scripts link`

### Adding new resource types

The manifest system is generic. To add a new resource type (e.g. containers):

1. Define a `CONTAINER_MANIFEST = "container.json"` constant.
2. Use `resolveManifestId(CONTAINER_MANIFEST, id, "container")` in commands.
3. Create a `link` command that saves the manifest via `saveManifest()`.

### Database ID resolution

`db` commands that target a specific database (`db show`, `db shell`, `db studio`, `db usage`, `db tokens create`, `db tokens invalidate`, `db regions *`, `db delete`, etc.) auto-resolve the database ID via `resolveDbId()` in `packages/cli/src/commands/db/resolve-db.ts`. Returns `{ id, source }` where `source` is `"argument" | "manifest" | "env" | "prompt"` so callers can surface a hint about where the ID came from.

**Resolution order:**

1. Explicit positional argument — `bunny db tokens create db_01KCHBG8...`
2. `.bunny/database.json` manifest — written by `bunny db link`, read via `loadManifest<DatabaseManifest>(DATABASE_MANIFEST)`
3. `BUNNY_DATABASE_URL` in `.env` — walks up the directory tree, parses the URL, matches it against the database list via API
4. Interactive prompt — fetches all databases and presents a select menu
5. If no databases exist — `UserError` with hint to run `bunny db create`

The URL (e.g. `libsql://...bunnydb.net/`) does not directly contain the `db_id`. The resolver fetches the database list and matches by URL to find the corresponding `db_id`. The manifest stores the `db_id` directly so no list lookup is needed for that path.

The manifest path mirrors `bunny scripts link` — both write to `.bunny/<resource>.json` via the same generic `saveManifest<T>()` helper in `packages/cli/src/core/manifest.ts`.

**Lifecycle integration:**

- `bunny db create` — the name is validated client-side against `DB_NAME_MAX_LENGTH` (16) before any API call, since longer names make the backend 500 instead of returning a validation error. After creating the database, prompts "Link this directory to <name>?" and (on yes) writes the manifest. If a link already exists it shows what will be replaced. The follow-up flow (link → token → save-env) exposes three flags for non-interactive control: `--link`/`--no-link`, `--token`/`--no-token`, `--save-env`/`--no-save-env`. When a flag is provided the prompt is skipped; in `--output json` mode prompts are suppressed entirely so flags become the only way to opt in. The JSON output then includes `linked`, `token`, and `saved_to_env` fields reflecting what happened.
- `bunny db delete` — after deleting the database, if `.bunny/database.json` points at the deleted ID it is removed silently via `removeManifest()` (no prompt — a manifest pointing at a deleted DB is unambiguously stale).

### `bunny.jsonc` (app config)

The `.bunny/` manifest and `bunny.jsonc` serve different purposes:

| Concern   | `.bunny/script.json`, `.bunny/database.json` | `bunny.jsonc`                                      |
| --------- | -------------------------------------------- | -------------------------------------------------- |
| Purpose   | Link directory to remote resource ID         | App config: name, containers, regions              |
| Author    | Machine (written by `link` command)          | Human (edited by developer) + machine (init, pull) |
| Committed | No (gitignored)                              | Yes                                                |
| Shared    | No (per-developer)                           | Yes (team-wide)                                    |

`bunny.jsonc` supports a `$schema` property for editor autocompletion, pointing to the JSON Schema generated by `@bunny.net/config`:

```jsonc
{
  "$schema": "./node_modules/@bunny.net/config/generated/schema.json",
  "version": "2026-05-11",
  "app": {
    "name": "my-app",
    "regions": ["sfo"],
    "containers": {
      "web": { "image": "nginx:latest" },
    },
  },
}
```

`version` is an ISO date string. The apps flow requires it on load — if a config is missing `version`, `loadConfig` throws a `UserError` with a hint to regenerate via `bunny apps pull`. (The sites flow is lenient: a sites-only file needs neither `version` nor an `app` block.) There is no migration runner yet; when the first breaking shape change ships, that PR introduces one alongside its transform.

Schemas and types are defined in `@bunny.net/config` using Zod. `core/bunny-config.ts` owns `bunny.jsonc` discovery + raw read (shared by the apps and sites flows). The apps `config.ts` layers validation, resolution helpers (`resolveAppId`, `resolveContainerId`), and writes: a new file is serialized fresh with `$schema` + `version` first, while an existing file is edited surgically via `core/jsonc.ts` (`syncJsonc`) so comments, key order, and a sibling `sites` block survive.

**Persistence model.** Three layers, with strict roles:

- **`bunny.jsonc`** - committable deploy _intent_. App name, container shapes (dockerfile/image-pin/env/endpoints/volumes/command), scaling, regions. No account-scoped identities, no per-deploy artifacts.
- **`.bunny/app.json`** - per-user _identity_ state (gitignored). `id` (app ID), container-template IDs, account-scoped registry IDs, the CLI profile this link was made under. Stored via the shared `core/manifest.ts` helpers (`loadManifest`, `saveManifest`, `removeManifest`) - the same generic pattern used by `db/` (`database.json`) and `scripts/` (`script.json`). The filename `app.json` and the `AppManifest` interface live in `apps/constants.ts`. Created by `bun-ny apps link <app-id>`, mutated during `apps deploy` and `apps pull`, dropped by `apps unlink` or `apps delete`.
- **MC API** - source of truth for _deployed state_. The currently-running image digest and the live config.

To keep these consistent and stop file churn on every deploy, `saveConfig` (`apps/config.ts`) calls `stripTransientFields` before writing - it removes `app.id`, per-container `registry`, and any `image` field on a container that has `dockerfile` set. Pre-built `image:` refs (e.g. `nginx:1.27`) are preserved because they're universally resolvable upstream identifiers, not account-scoped or build-time artifacts.

`resolveAppId` and `resolveContainerRegistry` in `apps/config.ts` read from the manifest first, then fall back to legacy `app.id` / `container.registry` in `bunny.jsonc` with a one-time deprecation warning. Existing pre-manifest configs continue to work; the next save naturally migrates them by stripping the legacy fields once the manifest carries the same data.

In-memory mutations during a deploy run (`targetContainer.image = imageRef`) are still required so `configToAddRequest` / `configToPatchRequest` can read the ref within the same run - they just don't make it to disk. Registry IDs for the API body are supplied via the new `RegistryMap` argument to `configToAddRequest` / `configToPatchRequest` (`@bunny.net/config`), sourced from the manifest at the call site.

---

## Database Shell (`bunny db shell`)

### Overview

The database shell is an interactive SQL REPL that connects to a Bunny Database via `@libsql/client`. It supports both interactive mode (readline-based REPL) and non-interactive mode (execute a query and exit).

### Architecture

The shell is split across two packages:

- **`@bunny.net/database-shell`** (`packages/database-shell/`) — Framework-agnostic shell engine. Contains the REPL, dot-commands, result formatting, masking, history, and SQL parsing. Accepts a `@libsql/client` `Client` instance and an optional `ShellLogger` interface for output.
- **`@bunny.net/cli`** (`packages/cli/src/commands/db/shell.ts`) — Thin CLI wrapper. Handles credential resolution (API client, `.env` lookup, interactive prompts), yargs command definition, and delegates to the shell package.

**Shell engine components** (in `packages/database-shell/src/`):

- **REPL** (`shell.ts`) — `startShell()`, `executeQuery()`, `executeFile()`. Uses `node:readline` with multi-line SQL support.
- **Dot-commands** (`dot-commands.ts`) — `.tables`, `.schema`, `.describe`, `.indexes`, `.fk`, `.er`, `.count`, `.size`, `.truncate`, `.dump`, `.read`, `.mode`, `.timing`, `.mask`, `.unmask`, `.save`, `.view`, `.views`, `.unsave`, `.clear-history`, `.help`, `.quit`.
- **Formatting** (`format.ts`) — `printResultSet()` with 5 output modes: `default`, `table`, `json`, `csv`, `markdown`. Sensitive column masking (full mask for passwords/secrets, email mask for email columns).
- **Views** (`views.ts`) — Saved queries scoped per database. Stored at `~/.config/bunny/views/<databaseId>/` (respects `XDG_CONFIG_HOME`). Callers can override via `ShellOptions.viewsDir`.
- **History** (`history.ts`) — Stored at `~/.config/bunny/shell_history` (respects `XDG_CONFIG_HOME`). Max 1000 entries.
- **SQL parsing** (`parser.ts`) — `splitStatements()` for `.sql` file execution.

**Dependency injection** — The shell engine accepts a `ShellLogger` interface instead of importing the CLI logger directly:

```typescript
interface ShellLogger {
  log(msg?: string): void;
  error(msg: string): void;
  warn(msg: string): void;
  dim(msg: string): void;
  success(msg: string): void;
}
```

**CLI wrapper** (`packages/cli/src/commands/db/shell.ts`) provides:

- Credential resolution (--url/--token flags → .env → API lookup)
- `shellLogger()` adapter that wraps the CLI `logger`
- `createClient()` call and delegation to `startShell()`/`executeQuery()`/`executeFile()`
- Passes resolved `databaseId` and optional `--views-dir` to `startShell()` for saved views

### Read quota protection

Dot-commands that perform full table scans (`.count`, `.size`, `.dump`) warn the user and require confirmation via `confirmReadQuota()` before executing, since reads count against the database quota.

### Non-interactive mode

SQL can be passed as a positional argument or via `--execute`/`-e`. Smart detection: if the first positional doesn't start with `db_`, it's treated as the query rather than a database ID.

If the value ends with `.sql` and the file exists, statements are read from the file instead — split on `;` and executed sequentially. Execution stops on the first error.

```bash
bunny db shell "SELECT * FROM users"
bunny db shell db_01ABC "SELECT * FROM users"
bunny db shell -e "SELECT * FROM users" -m json
bunny db shell -e seed.sql
bunny db shell seed.sql
```

---

## Conventions for Adding New Commands

1. Create a new directory under `packages/cli/src/commands/` for the domain (e.g., `packages/cli/src/commands/deploy/`).
2. Create `index.ts` using `defineCommand()` for leaf commands or `defineNamespace()` for groups.
3. Use `builder` to define command-specific flags. Use positionals for required arguments (`command: "create <name>"`).
4. **Add flag equivalents for every interactive prompt** so the command is fully scriptable (see "Agent & Scripting Compatibility").
5. Use `preRun` for validation that should prevent execution.
6. Access global flags (`profile`, `verbose`, `output`) directly from the args object.
7. Resolve config via `resolveConfig(args.profile, args.apiKey, args.verbose)` when API access is needed.
8. Use `logger` for all output. **Every command that returns data must support `--output json`.**
9. Throw `UserError` for expected failures. Let unexpected errors propagate to the factory's catch block.
10. Register the new command/namespace in `packages/cli/src/cli.ts`.

---

## Roadmap: Plugin System

The CLI is designed to support a future plugin ecosystem. This section documents the planned architecture so that current work remains compatible with it.

### Concept

Plugins are npm packages that export yargs `CommandModule` objects (the same shape produced by `defineCommand` and `defineNamespace`). The CLI discovers and registers them at startup.

### Plugin discovery

Plugins are listed in the user's config file (`~/.bunny/config.jsonc`):

```jsonc
{
  "profiles": { ... },
  "plugins": [
    "bunny-cli-plugin-analytics",
    "@acme/bunny-cli-plugin-deploy"
  ]
}
```

### Plugin management commands

```
bunny plugins list              # Show installed plugins
bunny plugins add <package>     # Install + register in config
bunny plugins remove <package>  # Unregister + uninstall
```

### Prerequisites

Before plugins can ship, the CLI core utilities need to be extracted into a shared package (`@bunny.net/cli-core`) so plugin authors can use the same primitives:

- `defineCommand`, `defineNamespace`
- `resolveConfig`, `clientOptions`
- `formatTable`, `formatKeyValue`
- `logger`, `UserError`

### Design principles

- **Keep `defineCommand` and `defineNamespace` interfaces clean and stable** — they will become the public plugin API.
- **Built-in over plugin for core bunny.net primitives** — analytics, streaming, storage sync, DNS, and logs should be first-class commands, not plugins.
- **Plugins are best for**: framework-specific adapters (Next.js, Laravel, WordPress), third-party integrations (Datadog, Slack, PagerDuty), and organization-specific workflows.
- **Unix composability first** — built-in commands should output to stdout in structured formats (`--output json`) so users can pipe to any tool. Plugins add value with pre-built integrations on top.
