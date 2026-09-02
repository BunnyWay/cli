# AGENTS.md: bunny.net CLI

Architecture and conventions for the bunny.net CLI monorepo. This file covers **how to work on this codebase**: the rules, the layering, and the decisions you cannot infer by reading the source.

It deliberately does **not** document what each command does or list every file. Those rot. For command behaviour read `packages/cli/README.md` (or run `bunny <cmd> --help`); for a package's public API read that package's README; for the file layout run `ls`.

---

## Overview

`bunny` is a CLI for bunny.net services (CDN, DNS, Edge Storage, Edge Scripting, Magic Containers, Sites, Databases). TypeScript on the Bun runtime, command tree built on `yargs`, profile-based auth.

---

## Runtime & tooling

Bun replaces the entire Node.js toolchain: no separate transpiler, bundler, test runner, or executable packager. `tsconfig.json` exists only for editor type-checking (`tsc --noEmit`).

| Concern          | Command                                         |
| ---------------- | ----------------------------------------------- |
| Run              | `bun run packages/cli/src/index.ts <command>`   |
| Watch            | `bun --watch packages/cli/src/index.ts`         |
| Test             | `bun test`                                      |
| Type-check       | `bun run typecheck` (`tsc --noEmit`)            |
| Compile          | `bun build packages/cli/src/index.ts --compile` |
| Regenerate types | `bun run openapi:generate`                      |

Platform primitives: `Bun.serve()` (auth callback server), `Bun.spawn()` (browsers, subprocesses), `Bun.file`, `Bun.Glob`, auto-loaded `.env`.

### Packages we deliberately do not use

- No `dotenv`: Bun loads `.env` automatically.
- No `execa`: use `Bun.spawn()` or `Bun.$`.
- No `express` or `node:http`: use `Bun.serve()`.
- No `ink` or `react`: the stack is `ora` + `prompts` + `chalk`.
- No `commander` or `clipanion`: we use `yargs`.
- No `cosmiconfig`: config resolution is hand-rolled to match the Go CLI's behaviour.
- No `@libsql/client`: `@bunny.net/database-client` is our own and everything database-related goes through it.

---

## Packages

Bun workspace monorepo. Run `ls packages/` for the authoritative list; the platform-specific binary packages (`cli-*`, `database-shell-*`) hold only a `package.json` plus a compiled binary and are published by CI.

| Package                           | Published | Purpose                                                                                |
| --------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `@bunny.net/cli`                  | yes       | The CLI. Depends on everything below.                                                  |
| `@bunny.net/openapi-client`       | yes       | Type-safe API client generated from OpenAPI specs. Zero CLI deps.                      |
| `@bunny.net/database-client`      | yes       | SQL client for Bunny Database. `fetch`-only hrana-over-HTTP. Zero deps.                |
| `@bunny.net/database-shell`       | yes       | Standalone SQL shell engine (REPL, dot-commands, formatting, masking). Binary: `bsql`. |
| `@bunny.net/sandbox`              | yes       | Sandbox SDK over Magic Containers provisioning plus an SSH/SFTP transport.             |
| `@bunny.net/scriptable-dns-types` | yes       | Ambient declarations for the Scriptable DNS runtime globals. Types only.               |
| `@bunny.net/database-rest`        | no        | Mountable REST surface over a database.                                                |
| `@bunny.net/database-adapter`     | no        | Introspection and adapter layer shared by studio and REST.                             |
| `@bunny.net/database-openapi`     | no        | OpenAPI description of the REST surface.                                               |
| `@bunny.net/database-studio`      | no        | Local web UI served by `db studio`.                                                    |
| `@bunny.net/config`               | no        | Zod schemas, types, and JSON Schema for `bunny.jsonc`.                                 |

Each package's README is the reference for its public API. Do not restate it here.

`packages/` also contains `actions/`, `app-config/`, and `project-config/`: empty, git-ignored leftovers holding only a stale `node_modules`. They are not workspace members and can be deleted.

---

## Layout & layering

```
packages/cli/src/
├── index.ts       # entry point: shebang + cli.parse()
├── cli.ts         # root yargs instance, global flags, command registration
├── core/          # shared internals: factories, logger, format, ui, errors, manifest
├── config/        # profile/config file schema, resolution, paths
└── commands/      # one directory per domain
```

- **One command per file.** Each file in `commands/` exports a single command or namespace.
- **Namespaces are directories** with an `index.ts` calling `defineNamespace()`. Leaf commands are `.ts` files calling `defineCommand()`.
- **Top-level commands** (`login`, `logout`, `whoami`, `open`, `docs`, `api`) register directly in `cli.ts`.
- **`core/` never imports from `commands/`.** Layering is one-way. When two domains need the same vocabulary, lift it into `core/` and re-export, do not import upward or duplicate.
- **Keep `core/` mostly flat.** A cohesive reusable feature spanning several files may take a subdirectory (`core/hostnames/`).
- **Error classes are split.** `UserError` and `ApiError` live in `@bunny.net/openapi-client` because the SDK needs them; `ConfigError` extends `UserError` in the CLI. `core/errors.ts` re-exports the first two.

---

## Command pattern

### `defineCommand<A>(def)`

```typescript
export const myCommand = defineCommand<{ env: string; dryRun: boolean }>({
  command: "deploy",
  aliases: ["d"],
  describe: "Deploy your project.",
  builder: (yargs) =>
    yargs
      .option("env", { alias: "e", type: "string", default: "production" })
      .option("dry-run", { type: "boolean", default: false }),
  preRun: async (args) => {
    if (!args.env) throw new UserError("--env is required");
  },
  handler: async ({ env, dryRun, profile, verbose, output }) => {},
  postRun: async (args) => {},
});
```

The factory wraps every handler in a try/catch that separates `UserError` (clean message, exit 1) from unexpected errors (stack trace when verbose, exit 2). `preRun` is for validation that should block execution; `postRun` for cleanup.

`hidden: true` keeps a command out of help while it still parses. Used for moved-command stubs such as `sandbox cp`, which errors and points at `sandbox files cp` (without the stub, yargs suggests an unrelated command).

### `defineNamespace(command, describe, subcommands)`

Groups subcommands and enforces `demandCommand(1)`, so a bare namespace shows help. Pass `false` as the second positional for a hidden alias namespace (`pz` for `pullzone`, `hostnames` for `domains`).

---

## Global flags

Registered on the root yargs instance with `global: true`, available on every handler's args object.

| Flag        | Alias | Type      | Default     | Description                                               |
| ----------- | ----- | --------- | ----------- | --------------------------------------------------------- |
| `--profile` | `-p`  | `string`  | `"default"` | Configuration profile to use                              |
| `--verbose` | `-v`  | `boolean` | `false`     | Verbose/debug output                                      |
| `--output`  | `-o`  | `string`  | `"text"`    | Output format: `text`, `json`, `table`, `csv`, `markdown` |
| `--api-key` |       | `string`  |             | API key; takes priority over profile and environment      |

Root instance also sets: a branded landing page as the `$0` default command, `recommendCommands()`, `strict()`, `.version()`, `.help()`, and `.completion()`.

---

## Output, logging, and formatting

`core/format.ts` owns rendering. `OutputFormat` is `"text" | "json" | "table" | "csv" | "markdown"`.

| Function                             | Purpose                                             |
| ------------------------------------ | --------------------------------------------------- |
| `formatTable(headers, rows, format)` | Tabular data for `text`, `table`, `csv`, `markdown` |
| `formatKeyValue(entries, format)`    | Key-value pairs as a 2-column table                 |
| `maskSecret(value)`                  | Masked form, keeps the last 4 characters            |

**Handle `json` first, then delegate:**

```typescript
handler: async ({ output }) => {
  const result = await fetchSomething();
  if (output === "json") {
    logger.log(JSON.stringify(result));
    return;
  }
  logger.log(formatTable(["Name", "Status"], rows, output));
};
```

`text` is a borderless table, `table` is bordered, `csv`/`markdown` are string-built. `json` is never handled by the format functions: each command serializes its own payload.

Use `logger` from `core/logger.ts` for all user-facing output: `info`, `success`, `warn`, `error`, `dim`, `debug(msg, verbose)`.

**NO_COLOR** is respected. `chalk` handles it natively; `cli-table3` needs `style: { head: [], border: [] }` passed explicitly when `chalk.level === 0`, which `format.ts` and the shell's `format.ts` both do.

### Secret masking

Mask every sensitive value (API keys, passwords, S3 secret keys, auth tokens) in default output; reveal only behind an explicit flag such as `--show-secret`. `--output json` masks exactly like the table.

Two deliberate exceptions:

- **Tool-config output** (`--format rclone|aws|s3cmd|env`) always emits full values, because its entire purpose is to be consumed by another tool.
- **A prompt or flag whose whole purpose is handing over credentials** counts as asking (`storage zones add --connection http|ftp|s3`). It prints in full with a "treat like a password" warning; masking there would leave the user with nothing usable.

`storage zones credentials` keeps masking by default because there the credential is the whole command and it may be run casually. Commands that merely happen to hold a zone (list, show, inspect) must never print one; see `toSafeStorageZone`.

**Never print a secret the user did not explicitly ask to see.**

---

## Error handling

- **`UserError`**: expected failure from user input or missing config. Clean message plus optional hint. Exit 1.
- **`ConfigError`**: extends `UserError`, auto-hints `bunny config show`.
- **`ApiError`**: extends `UserError`. Carries `status`, optional `field`, optional `validationErrors[]`.

The bunny.net APIs return two different error shapes. `authMiddleware()` in `packages/openapi-client/src/middleware.ts` normalizes both into `ApiError` in an `onResponse` handler, so command code never touches raw HTTP errors:

- RFC 7807 (`title`/`detail`, used by Magic Containers) maps to `ApiError(detail || title, status, undefined, errors)`.
- `ApiErrorData` (`Message`/`Field`/`ErrorKey`, used by Core and Compute) maps to `ApiError(Message, status, Field)`.
- An empty body gets a sensible default message per status code.

Under `--output json` the error payload carries all available context (`error`, `status`, `field`, `validationErrors`).

| Exit code | Meaning                                           |
| --------- | ------------------------------------------------- |
| 0         | Success                                           |
| 1         | User error (bad input, missing config, API error) |
| 2         | Unexpected/internal error                         |

---

## Configuration & authentication

### Config file

A single JSON file holding profiles, matching the Go CLI format for backward compatibility. Schema in `packages/cli/src/config/schema.ts` (Zod). Resolution order, first match wins:

1. `$XDG_CONFIG_HOME/bunnynet.json`
2. `~/.config/bunnynet.json`
3. `~/.bunnynet.json`
4. `/etc/bunnynet.json`

Writes go to the first existing candidate, else the first candidate overall. Files are written `0o660`.

### Resolution precedence

`resolveConfig(profile, apiKeyOverride?, verbose?)`, highest wins:

1. `--api-key` flag
2. `BUNNYNET_API_KEY` / `BUNNYNET_API_URL`
3. Config file profile matched by `--profile`
4. Defaults (`https://api.bunny.net`, empty key)

If `--api-key` or `BUNNYNET_API_KEY` is set the config file is ignored entirely and the profile field becomes `""`. A named profile that does not exist throws; `"default"` does not.

**Always pass `profile` and `apiKey`, and pass `verbose`** so credential-source debug lines respect the flag.

### Environment variables

| Variable                 | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `BUNNYNET_API_KEY`       | API key; overrides any profile key      |
| `BUNNYNET_API_URL`       | API base URL                            |
| `BUNNYNET_DASHBOARD_URL` | Dashboard URL for the browser auth flow |
| `NO_COLOR`               | Disable colored output                  |

### Login

`bunny login` runs a loopback browser flow: random 16-byte hex state token for CSRF, `Bun.serve({ port: 0 })` callback server, dashboard auth URL, browser opened via `Bun.spawn()` with the URL also printed as a fallback, 5-minute timeout, state validated on callback, key verified against `/user`, embedded HTML success page served back.

A 401 on verification throws `UserError` and leaves the profile untouched. Any other verification failure is treated as unverified and the key is still saved.

**Headless handling matters more than the happy path.** The loopback flow needs a browser the user can actually see, which rules out SSH, containers, and CI. `detectHeadless()` in `core/headless.ts` returns the first matching `HeadlessReason` (`ssh`, `ci`, `container`, `no-display`, `unsupported-platform`) or `null`. SSH is checked first because it is the likeliest explanation when several match.

| Situation           | Behaviour                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--api-key` passed  | Skips detection; verifies and saves                                                                                                                                |
| Browser plausible   | Opens the browser                                                                                                                                                  |
| Headless with a TTY | Warns with the reason, offers a masked key paste or prints the login URL plus the matching `ssh -L` forward (the callback port is random and bound to `127.0.0.1`) |
| Headless, no TTY    | Throws `UserError` pointing at `--api-key`, rather than waiting 5 minutes for a browser that will never open                                                       |

`detectHeadless()` takes `env`, `platform`, and the container-marker probe as injectable parameters, so the branches stay unit-testable even when the suite itself runs in a container.

---

## Prompts & interactivity

All of this lives in `core/ui.ts`. The rules here are load-bearing.

**Always import `prompts` from `core/ui.ts`, never from the `prompts` package.** The raw library spins at 100% CPU when stdin hits EOF. The wrapper refuses non-TTY stdin up front. `ui.test.ts` carries a ratchet test that fails if any file outside `ui.ts` imports the library at runtime.

**Piped prompt answers are deliberately unsupported.** Flags and `--force` are the automation contract. `prompts.inject()` still works in tests.

| Helper                                                 | Behaviour                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readPassword(message)`                                | Masked input                                                                                                                                                                                                                                                                                          |
| `confirm(message, opts?)`                              | Gate by default: if stdin closes before an answer it throws, so the command exits non-zero. Pass `optional: true` only for offer-style prompts ("link this directory?", "save to .env?") where declining is normal and the command should continue.                                                   |
| `confirmTyped(...)`                                    | Type-the-name confirmation for destructive actions                                                                                                                                                                                                                                                    |
| `requireConfirmable(output, { force, message, hint })` | Guard called immediately before a `confirm()` that gates a destructive action. Returns silently under `force` or when interactive; otherwise throws with `hint`. Without it an unattended run blocks forever on a prompt nobody can answer, and the prompt lands on stdout ahead of the JSON payload. |
| `spinner(text)`                                        | `ora` spinner, auto-silenced when stdout is not a TTY                                                                                                                                                                                                                                                 |

---

## Agent & scripting compatibility

The CLI must be fully usable by agents, scripts, and pipelines.

- **Every prompt has a flag equivalent.** Confirmations get `--force`; text and password input get a named flag. If a required value is missing and no flag supplied it, **error immediately rather than blocking on stdin**.
- **Under `--output json`**: valid JSON on stdout, one object or array per command. Errors are JSON too (`{ "error": ..., "hint": ... }`), handled by `defineCommand()`. No spinners, no colors, no tables, no blank lines. Exit codes still apply.
- **Prompts are suppressed entirely under `--output json`**, so flags become the only way to opt into follow-up behaviour. Commands with interactive follow-ups expose paired flags (`--link`/`--no-link`, `--token`/`--no-token`, `--save-env`/`--no-save-env`) and report what happened in the JSON payload.

### Agent skill installer

`bunny skills install` writes the shipped `skills/bunny-cli/` skill into the user's environment so coding agents discover the CLI at all. The generic machinery is in `core/agent-skill.ts` so future per-resource skills can reuse it.

- **Project install (default)**: upserts a marked block (`<!-- bunny-cli:start/end -->`) into the project's `AGENTS.md`, and writes the full skill to `.agents/skills/bunny-cli/`, adding `.claude/skills/bunny-cli/` when the project uses Claude Code. Markers are per-skill so several blocks coexist; a malformed block (missing, reversed, or duplicated marker) errors instead of guessing.
- **Global install (`--global`)**: writes to `~/.agents/skills/bunny-cli/` (the cross-tool Agent Skills directory) and `~/.claude/skills/bunny-cli/`. Nothing project-local is touched.
- **Installing into the home directory is refused.** Per-user config dirs would otherwise read as project markers and apply to every directory you work in. The filesystem root is refused for the same reason. Removal is still allowed there so a stray `AGENTS.md` can be cleaned up, but it strips only the marked block.
- **Symlink escapes are refused**, so a checkout cannot plant links that make the installer overwrite unrelated files. Symlinks resolving inside the project are followed.
- **`SKILL.md` is a completion sentinel**: boundary-checked, removed first and written last per root, and the installed check requires every global root. Partial installs and failed refreshes therefore re-offer.
- **Single source of truth**: `commands/skills/content.ts` embeds `skills/bunny-cli/**` at bundle time via Bun text imports, so the installed skill is always the shipped one. `content.test.ts` fails if `SKILL.md` routes to a reference that is not embedded.
- **Experimental namespaces stay out** of the skill and the AGENTS.md section (`apps`, `registries`); add them back when they graduate to the visible command list in `cli.ts`. `sites` is the exception: hidden from help but documented, since agents deploy with it.
- **Onboarding nudges**: `bunny login` makes a one-time interactive offer (`--install-skill` / `--no-install-skill` decide it without prompting). Users who authenticate another way get a one-time passive stderr hint instead. Both share one marker file in the XDG cache dir, so users see at most one. The marker is written on a decline or a successful install only, so an interrupted prompt re-offers.

---

## Local context: `.bunny/` manifests and `bunny.jsonc`

Two different things with strict roles.

| Concern   | `.bunny/<resource>.json`                    | `bunny.jsonc`                                    |
| --------- | ------------------------------------------- | ------------------------------------------------ |
| Purpose   | Link this directory to a remote resource ID | Declared config: app, sites, containers, regions |
| Author    | Machine (written by `link`)                 | Human, plus machine (`init`, `pull`)             |
| Committed | No (gitignored)                             | Yes                                              |
| Shared    | No (per-developer)                          | Yes (team-wide)                                  |

### Manifests

`core/manifest.ts` owns the generic helpers (`loadManifest`, `saveManifest`, `removeManifest`, `resolveManifestId`). `findRoot()` walks up the tree, so commands work from subdirectories. Each resource owns its filename and interface in its own `constants.ts` (`APP_MANIFEST`, `DNS_MANIFEST`, `STORAGE_MANIFEST`, and so on).

**Before building anything manifest-shaped, check `core/manifest.ts` first.** The generic layer already exists.

Standard resolution order: explicit positional or flag, then the manifest file, then a `UserError` hinting at the `link` command. Interactive commands may insert a picker before the error; the picker must be skipped, with an error, under `--output json` or no TTY.

Databases add two steps. `resolveDbId()` returns `{ id, source }` where `source` is `"argument" | "manifest" | "env" | "prompt"`, resolving through: explicit argument, `.bunny/database.json`, `BUNNY_DATABASE_URL` in a `.env` found by walking up (matched against the database list by exact URL, not by parsing the ULID out of the subdomain), then an interactive picker. Deleting a database silently drops a manifest pointing at it, since that is unambiguously stale.

### `bunny.jsonc`

Supports `$schema` for editor autocompletion, pointing at the JSON Schema generated by `@bunny.net/config`.

```jsonc
{
  "$schema": "./node_modules/@bunny.net/config/generated/schema.json",
  "version": "2026-05-11",
  "app": {
    "name": "my-app",
    "regions": ["sfo"],
    "containers": { "web": { "image": "nginx:latest" } },
  },
}
```

`core/bunny-config.ts` owns discovery and raw reads (`findConfigRoot`, `configPath`, `configExists`, `readBunnyConfig`), shared by the apps and sites flows. The apps `config.ts` layers validation and resolution (`resolveAppId`, `resolveContainerId`, `resolveContainerRegistry`); the sites `loadSiteConfig` validates only the `sites` block, so a sites-only file needs neither `version` nor an `app` block. The apps flow does require `version` and errors with a hint to run `apps pull`. There is no migration runner yet; the first breaking shape change ships one alongside its transform.

**Every writer must edit surgically.** A new file is serialized fresh with `$schema` and `version` first, but an existing file goes through `syncJsonc()` in `core/jsonc.ts` so comments, key order, and sibling blocks survive.

### Apps persistence model

Three layers, strict roles:

- **`bunny.jsonc`**: committable deploy _intent_. Names, container shapes, scaling, regions. No account-scoped identities, no per-deploy artifacts.
- **`.bunny/app.json`**: per-user _identity_ state. App ID, container-template IDs, account-scoped registry IDs, the profile the link was made under.
- **MC API**: source of truth for _deployed state_, the running image digest and live config.

`saveConfig` calls `stripTransientFields` before writing, removing `app.id`, per-container `registry`, and any `image` on a container that has `dockerfile` set. Pre-built `image:` refs are preserved, because they are universally resolvable upstream identifiers rather than account-scoped build artifacts. In-memory mutation during a deploy is still required so the conversion functions can read the ref within the run; it just never reaches disk.

`resolveAppId` and `resolveContainerRegistry` read the manifest first and fall back to legacy `bunny.jsonc` fields with a one-time deprecation warning, so the next save migrates old configs naturally.

---

## API clients

`openapi-fetch` with types generated by `openapi-typescript` from committed specs in `packages/openapi-client/specs/`. Generated `.d.ts` land in `src/generated/` and are gitignored.

| Client           | Factory                      | Base URL                               | Auth                   |
| ---------------- | ---------------------------- | -------------------------------------- | ---------------------- |
| Core             | `createCoreClient()`         | `https://api.bunny.net`                | Account `AccessKey`    |
| Compute          | `createComputeClient()`      | `https://api.bunny.net`                | Account `AccessKey`    |
| Database         | `createDbClient()`           | `https://api.bunny.net/database`       | Account `AccessKey`    |
| Magic Containers | `createMcClient()`           | `https://api.bunny.net/mc`             | Account `AccessKey`    |
| Origin Errors    | `createOriginErrorsClient()` | `https://cdn-origin-logging.bunny.net` | Account `AccessKey`    |
| Shield           | `createShieldClient()`       | `https://api.bunny.net`                | Account `AccessKey`    |
| Storage          | `createStorageClient()`      | `https://storage.bunnycdn.com`         | Storage Zone password  |
| Stream           | `createStreamClient()`       | `https://video.bunnycdn.com`           | Stream Library API key |

All factories take a `ClientOptions` (`apiKey`, `baseUrl?`, `verbose?`, `userAgent?`, `onDebug?`) and inject headers via the shared `authMiddleware()`.

**In command handlers, build it with `clientOptions(config, verbose)`** from `core/client-options.ts`, which supplies the CLI version as `userAgent` and `logger.debug` as `onDebug`:

```typescript
import { createCoreClient } from "@bunny.net/openapi-client";

handler: async ({ profile, apiKey, verbose }) => {
  const config = resolveConfig(profile, apiKey, verbose);
  const api = createCoreClient(clientOptions(config, verbose));
  const { data, error } = await api.GET("/pullzone/{id}", { params: { path: { id: 12345 } } });
};
```

**Import from `@bunny.net/openapi-client`, never relative paths.** Import generated types from the per-API entrypoints (`@bunny.net/openapi-client/core`); the older `generated/<spec>.d.ts` paths still work.

### Type conventions

Prefer generated schema types over inline primitives:

```typescript
type Database = Pick<components["schemas"]["Database2"], "id" | "name" | "url">;
```

Fall back to `string`/`number`/`any` only when no generated type exists.

### Undocumented endpoints

Some endpoints are missing from the public specs. Type them manually in a `CustomPaths` type intersected with the generated `paths`. Type only the fields you actually use, and delete the entry once the endpoint reaches the spec.

Generation is lossy in places. `src/dns.ts` holds hand-authored corrections (for example `DnsDiscoveredRecord`, which adds the `Flags`/`Tag` a scan returns but generation drops). That file is the pattern for enriching generated types.

### Adding a new API

1. Add the spec JSON to `packages/openapi-client/specs/`.
2. Add an entry to `redocly.yaml`.
3. Run `bun run openapi:generate`.
4. Add a client factory in `src/` and export it from `src/index.ts`.
5. Add a per-API entrypoint module and a matching `./<api>` entry in the package `exports` map.

Spec source URLs are listed at https://bunny.net/docs/openapi. `scripts/update-specs.ts` is the authority for which ones this repo pulls; do not duplicate that list.

---

## Database stack

Everything database-related goes through `@bunny.net/database-client`. `db shell`, `db studio`, and `db migrations` all sit on top of it. Read the package READMEs for the APIs; what follows is the reasoning you cannot recover from them.

**Server-side only.** An auth token is a bearer credential for the whole database and the client sends raw SQL. Never describe it as browser-compatible even though `fetch`-only code would technically run there, and note that a read-only token does not fix it. The correct pattern is an Edge Script, or `database-rest` behind an auth check, holding the token and exposing only intended queries.

**Positional rows exist for a reason.** `runRaw()`/`batchRaw()` and the shell's rendering keep rows positional because object rows collapse duplicate column names.

### Credential resolution

`resolveCredentials()` in `commands/db/credentials.ts` is shared by shell, studio, and migrations apply. The invariant: **a credential the user did not pass on this command line is never sent to a target they did.**

- An explicit database ID skips `.env` entirely, since `.env` may describe a different database.
- A generated token only goes to a URL whose endpoint matches that database's canonical URL. The endpoint check runs _before_ the token is created, so nothing is created for an endpoint we would refuse.
- The `.env` token is reused for an explicit `--url` only on the same endpoint as the `.env` URL. Endpoint identity is hostname plus normalized TLS port, allowing equivalent `libsql:`, `https:`, and `wss:` schemes. Comparing against `.env` rather than the API keeps the fully-offline case network-free.
- Every URL must be encrypted, including one paired with an explicit `--token`. `libsql://host:port?tls=0` is rejected. The scheme check runs before any lookup or prompt, so an unusable URL fails immediately rather than after a database prompt. There is no plaintext local-database exception.

### Other database rules

- **Never leak error text through the REST surface.** `createRestHandler()` returns `{ message: "Internal error", code: "INTERNAL_ERROR" }` with a 500 and hands the real error to the optional `onError` hook, because a raw SQLite error would leak table names, column names, and file paths. `db studio` wires `onError` to its own logger, which is why failures print in the launching terminal rather than the browser.
- **Every CLI connection identifies itself** via `databaseUserAgent(command)` (`bunny-cli/<version> (db shell)` and so on). The CLI compiles the shell and studio from source into its binary, so those packages' own versions say nothing about the traffic. Standalone `bsql` keeps `bunny-database-shell/<version>`.
- **Full-scan dot-commands** (`.count`, `.size`, `.dump`) require confirmation via `confirmReadQuota()`, since reads count against the quota.
- **`db create` validates the name client-side** against `DB_NAME_MAX_LENGTH` (16) before any API call: longer names make the backend 500 instead of returning a validation error.

### Migrations

Plain `.sql` files the developer writes or generates. The CLI runs them in order, once each, and records what it ran. **There is no rollback**: SQLite cannot reverse most DDL, so the fix for a bad migration is another migration.

- Files live in `migrations/` by default, named `NNNN_<slug>.sql`. The **relative path is the migration's identity** and its zero-padded numeric prefix is the order. Nothing local tracks migrations: no journal, no manifest.
- Applied migrations are recorded in `__bunny_migrations`. The `__` prefix means `DEFAULT_EXCLUDE_PATTERNS` already hides it from studio and REST.
- All file and state logic sits in `migrations/engine.ts` so commands stay thin and the logic is testable against in-memory SQLite with no network.
- `checksum()` normalizes CRLF and trims edges, so reformatting line endings is not reported as a change.
- `migrationStatements()` parses **every** pending file before the first database write, so a malformed later file cannot produce a partial run.
- `applyMigration()` runs statements plus the tracking-row insert through one `batch()`, so a migration either lands and is recorded or neither.
- `readApplied()` checks `sqlite_master` rather than creating the tracking table, so `list` and `--dry-run` never write. Nothing is written before confirmation, including the tracking table, so a preview against read-only credentials still lists pending files.
- `batch(..., { foreignKeys: false })` brackets `BEGIN`/`COMMIT` from outside. **The client owns the pragma, not the ORM.** ORM-emitted `PRAGMA foreign_keys=OFF/ON` lands inside the transaction where SQLite ignores it; table rebuilds and `ALTER TABLE` need enforcement genuinely off.
- `resolveMigrationsDir()` falls back to `drizzle/` when `migrations/` is absent, but `resolveCreateMigrationsDir()` deliberately does not, so `create` never writes an unjournaled file into an ORM-owned directory.
- **One runner owns a history.** Bunny records relative paths in its own table and never reads or updates another tool's journal. Users should run their ORM's migrator directly rather than alternating runners over the same files.
- `apply` refuses to extend modified, missing, or out-of-order histories unless `--allow-drift`. It confirms when a TTY is attached and skips the prompt under `--force` or any non-interactive run.
- Output shows a **credential-free target** (`database-id (host)`); JSON includes `{ database_id, host }` and never the token, path, query, or user info.

---

## Pull-zone settings: the "Hybrid D" shape

Scripts, apps, and sites are each backed by a pull zone, which has a large settings surface (hostnames, caching, edge rules, origin, security, purge, CORS, optimizer, logging). To keep each owner's help legible:

- **Flatten only first-class groups** into the owner, picked by user mental model, kept to one or two. `domains` is the flattened group: a custom domain is "my site's address", not a CDN setting.
- **Group the long tail** under a `pullzone` sub-namespace inside the owner, so the owner's help gains one line rather than ten. Curate per owner and omit settings that do not apply (a script _is_ its pull zone's origin, so no origin-URL command under `scripts`).
- **A root `bunny pullzone`** (planned) is the canonical full surface for zones not backing anything, targeted by `--id`.
- **Each setting area is a mountable factory** like `createHostnamesCommands` in `core/hostnames/`, taking `{ commandPath, target, targetPositional, resolve(args), hiddenAliases }`. The resolver is the only per-surface difference: `--id` at the root, the linked manifest for scripts, the CDN endpoint for apps. `targetPositional` appends an optional trailing positional so each mount matches its namespace's convention.
- Canonical term is `pullzone` (matching the dashboard and API); `pz` is a hidden alias.

---

## Platform traps

Hard-won, not inferable from the code, and expensive to rediscover.

- **Magic Containers requires `linux/amd64`.** Builds must pass `--platform linux/amd64`; an arm64 image (the default on Apple Silicon) breaks the pull.
- **At the edge, `ctx.request.url` is origin-facing** (`http://<edge-ip>:9000/...`), not the requested host. The client hostname must come from the `CDN-Host`/`Host` headers. Hostname routing on `url.hostname` never fires.
- **Sites must use the edge rule `OriginStorage` action for deploy routing.** Its parameters are storage-zone ID, storage-zone name, and the origin path prefix (`/deploys/<id>/`). A `Change Origin URL` self-hop leaks that internal prefix into root-relative HTML links; pointing it at the Storage API instead loses linked-origin index handling and its injected `AccessKey` is not reliable at the edge. `OriginStorage` changes only the origin path, so the client URL stays clean while Storage authentication and `index.html` handling remain native. `BlockRequest` runs pre-cache, so it applies to cache hits too.
- **The pull zone delivery layer rewrites `Cache-Control`** from the zone's cache settings; origin- or script-set values reach browsers only when both `CacheControlMaxAgeOverride` and `CacheControlPublicMaxAgeOverride` are `-1`, and a `no-cache` the CDN respects also stops it storing the object. Sites sidesteps this with a zone-level override plus per-extension browser-cache rules.
- **Sites edge rules are identified by their `Description` strings** (constants in `sites/constants.ts`); upserts key on them, so treat them as frozen.
- **An unchanged, already-live `sites deploy` still converges and purges the site's edge rules.** It is the repair/upgrade path for existing sites, so do not return from the no-op branch before `promoteDeploy()`.
- **The `/storagezone/regions` endpoint is not reliable.** The region catalog is hand-maintained in the storage constants. The available set is a function of both tier and S3 support: Edge (SSD) zones can only be primaried in DE and the create API silently rewrites any other region rather than erroring, so reject a conflicting `--region` client-side.
- **Storage zone tier and S3 support are create-time only.** The update API takes neither.
- **Storage replication is irreversible.** There is no API to remove a replication region, so `update` models replication as additive: it offers only new regions, warns on omissions, and confirms before adding.
- **Wildcard hostnames can shadow deeper names** at the edge. `reportIssuedCertificate()` TLS-probes the hostname (retrying once) and warns instead of printing "Live at" when the edge answers with a bad certificate.
- **SSL cannot be pre-issued.** Certificate validation resolves through DNS pointing at bunny, so there is no useful preemptive or background issuance; the flow already issues as soon as it can.
- **`loadFreeCertificate` can return 200 without issuing.** `enableSsl()` verifies `HasCertificate` landed on the exact hostname afterwards, and skips Force SSL when it did not.
- **Trust live DNS over bunny's `NameserversDetected` flag**, which defaults true on a fresh zone. `checkDelegation()` reads the parent zone's NS referral with a raw UDP query of the registry rather than the recursive answer a child host could spoof.
- **Never add or repoint a DNS record without a prompt.** Detection is silent; only a genuine no-op skips the confirmation.
- **Never remove or overwrite `.env` values without asking**, even when they look stale.
- **Bulk record writes are per-record and resilient.** `writeRecords` collects `{ applied, failures }` so one bad record cannot strand the batch, and partial failures are reported.

---

## Build & distribution

```bash
bun build packages/cli/src/index.ts --compile --outfile bunny
bun build packages/cli/src/index.ts --compile --target=bun-linux-x64 --outfile bunny-linux-x64
```

Produces a single native executable with the runtime, dependencies, and source inside. Cross-targets: `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`.

Three distribution channels:

1. **Shell installer** (`install.sh` at the repo root): downloads the prebuilt binary into `~/.bunny/bin`, honours `BUNNY_INSTALL_DIR`, clears the quarantine xattr and ad-hoc codesigns on macOS so Gatekeeper allows execution, and uses the `releases/latest/download` redirect to avoid the API rate limit.
2. **npm**, via the platform-specific binary package pattern. `@bunny.net/cli` ships a JS shim that delegates to the right platform package. Platform packages are versioned in lockstep through the `fixed` array in `.changeset/config.json`.
3. **GitHub Releases**, with binaries attached by `.github/workflows/release.yml`.

### Publishing libraries

The published libraries (`openapi-client`, `sandbox`, `database-client`, and the database packages) share one pattern: `exports`/`main`/`types` point at `dist/`, while **in-repo tooling resolves them from source** through the root `tsconfig.json` `paths` mapping. `bun run`, `bun build --compile`, `bun test`, and `tsc` all honour `paths` over the package `exports`, so the dev loop needs no prebuild step and only publishing needs `dist/`. Published consumers never see the repo tsconfig and fall back to `exports`.

Per-package deviations, each with a reason:

- **`openapi-client`** regenerates its gitignored types first, then runs `scripts/build.ts`, which drives the TypeScript compiler API and copies the generated `.d.ts` into `dist/generated/` (tsc never emits its own inputs). `rewriteRelativeImportExtensions` fixes specifiers in emitted **JS**; TypeScript has no declaration-emit equivalent, so an `afterDeclarations` transformer rewrites them in the emitted **`.d.ts`** on the AST.
- **`sandbox`** depends on `openapi-client` with `workspace:*`, so its release job uses `bun publish`, which rewrites that spec to the local version in the tarball. `npm publish` would ship the unresolvable `workspace:*` verbatim. Its `tsconfig.build.json` overrides `paths` to `{}` so openapi-client resolves via `dist/` instead of source, which would otherwise violate `rootDir`; the job therefore builds openapi-client first.
- **`database-client`** is the simplest case: zero dependencies, so `npm publish` works, and no declaration transformer. `tsconfig.build.json` sets `include: ["src"]` to keep `examples/` out of the program. Because the program is scoped to `src`, the package cannot import its own `package.json`, which is why its default `User-Agent` is versionless.

Publish jobs for independently versioned packages are gated on a version bump detected via `npm view`. Only the CLI and its platform packages are in a `fixed` group.

**Note:** `database-shell` currently ships only `bin/` while exporting `src/index.ts`, so its library API is broken for npm consumers. Fixing it needs a `dist` build, not a `files` tweak.

### Release workflow

1. Create changesets on feature branches (`bun run changeset`). **One changeset per branch**: rewrite the existing headline rather than adding a second.
2. Merge to `main`; the changesets action opens or updates a Release PR.
3. Merge the Release PR to bump versions.
4. The release workflow builds all platforms, publishes platform packages then the CLI, and creates the GitHub release.

CI runs `bun run typecheck` and `bun test` on every PR.

---

## Adding a new command

1. Create a directory under `packages/cli/src/commands/` for the domain.
2. `index.ts` with `defineNamespace()` for a group; a `.ts` file per leaf with `defineCommand()`.
3. Define flags in `builder`. Use positionals for required arguments (`command: "create <name>"`).
4. **Add a flag equivalent for every prompt** so the command is fully scriptable.
5. Use `preRun` for validation that should block execution.
6. Read `profile`, `verbose`, and `output` straight off the args object.
7. Resolve config with `resolveConfig(args.profile, args.apiKey, args.verbose)`.
8. Use `logger` for all output. **Every command returning data must support `--output json`**, handled first.
9. Throw `UserError` for expected failures; let unexpected ones reach the factory's catch.
10. Guard destructive confirmations with `requireConfirmable`.
11. Register the command in `packages/cli/src/cli.ts`.
12. Update `packages/cli/README.md`. Update this file only if you changed a **rule**, not a command.

---

## Where else to look

| Question                            | File                                              |
| ----------------------------------- | ------------------------------------------------- |
| What does a command do?             | `packages/cli/README.md`, or `bunny <cmd> --help` |
| What is a package's API?            | that package's `README.md`                        |
| Apps (experimental)                 | `packages/cli/src/commands/apps/APPS.md`          |
| Repo scripts, changesets, local dev | root `README.md`                                  |
| Which specs do we pull?             | `packages/openapi-client/scripts/update-specs.ts` |
| What files exist?                   | `ls`, not a checked-in tree                       |
