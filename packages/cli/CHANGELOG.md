# @bunny.net/cli

## 0.4.0

### Minor Changes

- [#51](https://github.com/BunnyWay/cli/pull/51) [`c1896be`](https://github.com/BunnyWay/cli/commit/c1896be35be7808cde1c076a0a89bce54fa15a76) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `bunny open` command to open the bunny.net dashboard in the default browser. Use `--print` to print the URL instead.

- [#50](https://github.com/BunnyWay/cli/pull/50) [`2bcf964`](https://github.com/BunnyWay/cli/commit/2bcf96435193bf2bb119c804302a1978cbb252f2) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `bunny scripts create` command

  - New `bunny scripts create [name]` command for creating an Edge Script on bunny.net without scaffolding a project. Useful when you already have a project (e.g. ran `bunny scripts init` without `--deploy`) and need a remote script before running `bunny scripts deploy`.
  - Defaults the script name to the current directory name, creates a linked pull zone, and links the directory via `.bunny/script.json`.
  - Flags: `--type` (`standalone` or `middleware`), `--pull-zone`/`--no-pull-zone`, `--pull-zone-name`, `--link`/`--no-link`.
  - Refactored `scripts init` to share the underlying `createScript()` helper.

- [#53](https://github.com/BunnyWay/cli/pull/53) [`44b4788`](https://github.com/BunnyWay/cli/commit/44b4788381be351eb922ceb8bf17ea7dfe5d4832) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `--repo` alias for `--template-repo` on `bunny scripts init` and accept GitHub `owner/repo` shorthand. When a custom template repo is given without `--type`, the script type now defaults to `standalone`.

  After a script is created by `bunny scripts create` (and `bunny scripts init --deploy`), the CLI now prompts to open the linked pull zone hostname in the browser. Declining shows a reminder to make local changes and run `bunny scripts deploy <file>`.

### Patch Changes

- [#58](https://github.com/BunnyWay/cli/pull/58) [`db5b128`](https://github.com/BunnyWay/cli/commit/db5b128fac0bd87d6694141b7b475c4a65447f66) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - The "update available" notice now suggests the right command for how bunny was install

- [#55](https://github.com/BunnyWay/cli/pull/55) [`ccfb7c1`](https://github.com/BunnyWay/cli/commit/ccfb7c100ba97e4f1bbb6c9b1912a5430fe89f85) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Improve the `install.sh` shell installer:

  - Default install directory is now `~/.bunny/bin` (no sudo required). Set `BUNNY_INSTALL_DIR=/usr/local/bin` to keep the previous behaviour.
  - On macOS, the installer now clears the `com.apple.quarantine` xattr and ad-hoc codesigns the binary so Gatekeeper allows execution on first run (fixes "killed: 9" on Apple Silicon).
  - Resolving the latest version no longer calls `api.github.com` (rate-limited to 60 req/hr); it uses GitHub's `releases/latest/download` redirect instead.
  - The script now warns if a legacy `bunny` binary is still present at `/usr/local/bin/bunny`, since depending on PATH order it may shadow the new install. Remove it with `sudo rm /usr/local/bin/bunny`.

- [#57](https://github.com/BunnyWay/cli/pull/57) [`f22b6cb`](https://github.com/BunnyWay/cli/commit/f22b6cb4a5278021544cff3c7962d2a4310f8874) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix `bunny --version` failing with "Unknown argument: version". The
  update-check work in a previous release switched yargs to `.version(false)`
  plus a manual `--version` option, which interacts badly with strict mode.
  The `--version` flag is now intercepted before yargs parses, so the latest
  version is still fetched and an upgrade hint shown when outdated.

- [#56](https://github.com/BunnyWay/cli/pull/56) [`72cf2a8`](https://github.com/BunnyWay/cli/commit/72cf2a818a432a16d1807c19420d685c864a41dd) Thanks [@nocanoa](https://github.com/nocanoa)! - Added bunny.net ASCII art.

## 0.3.0

### Minor Changes

- [#44](https://github.com/BunnyWay/cli/pull/44) [`87d76e1`](https://github.com/BunnyWay/cli/commit/87d76e131a85a1419f0ebc05abb400e396c1fc5a) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `bunny db link` and lifecycle integration for `.bunny/database.json`

  - New `bunny db link [database-id]` command that writes `{ id, name }` to `.bunny/database.json`. Subsequent `db` commands resolve the target without needing `BUNNY_DATABASE_URL` in `.env`.
  - Database ID resolution order is now: explicit argument → `.bunny/database.json` → `BUNNY_DATABASE_URL` in `.env` → interactive prompt. The resolver also returns the database name when known, so commands like `db tokens create` can show `Database: <name> (<id>) (from ...)` without an extra API call.
  - `bunny db create` now offers to link the new database to the current directory, generate an auth token, and save credentials to `.env`. Three new flags make these phases non-interactive: `--link`/`--no-link`, `--token`/`--no-token`, `--save-env`/`--no-save-env`. In `--output json` mode, prompts are suppressed entirely — flags are the only way to opt in. The JSON output gains `linked`, `token`, and `saved_to_env` fields.
  - `bunny db delete` now removes `.bunny/database.json` automatically when it points at the deleted database, so subsequent commands don't try to resolve a dead ID.

### Patch Changes

- [#49](https://github.com/BunnyWay/cli/pull/49) [`61e1518`](https://github.com/BunnyWay/cli/commit/61e1518df6e24dcfc62ac5ef4c299b53a9275ebf) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Harden `bunny db studio` against LAN, cross-origin, and credential-persistence attacks

  - The studio HTTP server now binds to `127.0.0.1` instead of every interface, so LAN peers, container bridges, and VPC siblings can no longer reach it.
  - `Access-Control-Allow-Origin: *` and the `OPTIONS` preflight branch were removed. The SPA is same-origin (Vite proxies `/api` in dev; prod serves the SPA and API from the same port), so no cross-origin grant is needed. Evil pages loaded in another tab can no longer read the API.
  - Added a Host header allowlist (`localhost`, `127.0.0.1`, `[::1]`). Requests with any other Host are rejected with `403`, which blocks DNS-rebinding even if the server is reachable via a non-loopback address.
  - The API is now gated behind a per-startup session token. The auto-opened URL carries `?token=…` once; the client exchanges it for an HttpOnly, SameSite=Strict cookie via `POST /api/auth` and scrubs the token from the URL. Every other `/api/*` request requires the cookie (timing-safe compare) or returns `401`.
  - `db studio` now prints a warning and prompts for confirmation before starting, explaining that a full-access libsql token will be minted and loaded into a browser tab. A `--force`/`-f` flag skips the prompt for CI and agents.
  - The libsql token minted on each run now expires after 30 minutes instead of never. This bounds the blast radius if the token ever leaves the developer's machine.

- [#49](https://github.com/BunnyWay/cli/pull/49) [`61e1518`](https://github.com/BunnyWay/cli/commit/61e1518df6e24dcfc62ac5ef4c299b53a9275ebf) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Harden the `bunny login` loopback callback server

  - Every response (success and error) now sets `Cache-Control: no-store`, so browsers don't persist the `?state=…&apiKey=…` URL to disk cache.
  - Non-`GET` requests to `/callback` now return `405 Method Not Allowed` with an `Allow: GET` header instead of falling through and attempting to read query parameters.

## 0.2.8

### Patch Changes

- [#40](https://github.com/BunnyWay/cli/pull/40) [`1b77eea`](https://github.com/BunnyWay/cli/commit/1b77eeae362f442c1a3f920d70456c0911b69294) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix `db studio` for table and column names containing spaces

  The studio API rejected any identifier that didn't match
  `[a-zA-Z_][a-zA-Z0-9_]*`, returning a 400 "Invalid table name" for
  tables or columns with spaces. Replaced the validation with safe
  double-quote identifier escaping so any SQLite-valid name works.

- [#42](https://github.com/BunnyWay/cli/pull/42) [`3cd013d`](https://github.com/BunnyWay/cli/commit/3cd013dc0b3cfad3d49e0327ee81d181b6b8720f) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - improve `db studio` error handling

  A single broken table used to cause cascading UI problems:

  - `/api/tables` would 500 if any one table's row count failed, locking
    users out of the sidebar entirely. The endpoint now isolates per-table
    errors and returns a `null` row count for just the broken table.
  - The client's `fetch` wrapper now surfaces the server's `error` body in
    the thrown message instead of a bare `API error: 500`.
  - `TableView` now shows an error screen with a Retry button when a table
    fails to load, instead of silently rendering an empty half-initialized
    view. Refresh failures keep stale data visible with an inline banner.

## 0.2.7

### Patch Changes

- [`72759e7`](https://github.com/BunnyWay/cli/commit/72759e772dc5ca2810e59eb6ba8d5703633de398) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - embed studio assets in compiled CLI binary

  The database studio UI was returning "Not Found" when launched from
  the compiled binary because the static files weren't embedded in
  the executable. Studio assets are now bundled via Bun's file
  embedding at compile time.

## 0.2.6

### Patch Changes

- [`53b31a0`](https://github.com/BunnyWay/cli/commit/53b31a0732e6215d5b24df31351a62f9de3192aa) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - rebuild database studio

## 0.2.5

### Patch Changes

- [#16](https://github.com/BunnyWay/cli/pull/16) [`989ddd9`](https://github.com/BunnyWay/cli/commit/989ddd93b36cf158662cdb5a4f28c03032b994b4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Hide `registries` command from help output and landing page (moved to experimental commands)

- [#35](https://github.com/BunnyWay/cli/pull/35) [`55d7928`](https://github.com/BunnyWay/cli/commit/55d7928a035d2624a9ba31049d1570674c3f7553) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Strip API key from browser history after login callback

## 0.2.4

### Patch Changes

- [`0abadc3`](https://github.com/BunnyWay/cli/commit/0abadc3d5027ae717dc918b43866fc5b0543cf01) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix macOS binary killed on launch by pinning Bun to v1.3.11 (v1.3.12 produces unsigned binaries)

## 0.2.3

### Patch Changes

- [`4f4a84d`](https://github.com/BunnyWay/cli/commit/4f4a84dc0b0be1a302a03c2aa238c1259e2835ca) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix macOS binary killed on launch by ad-hoc signing darwin binaries during CI build

## 0.2.2

### Patch Changes

- [#28](https://github.com/BunnyWay/cli/pull/28) [`0e0e2ff`](https://github.com/BunnyWay/cli/commit/0e0e2ff419caf9218f6f5ee0b957b218d93f7f26) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add automatic update check that notifies users when a new CLI version is available

- [#32](https://github.com/BunnyWay/cli/pull/32) [`49dcf66`](https://github.com/BunnyWay/cli/commit/49dcf66ca8bb2740da9ec08abbbfa33bc0018d25) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add raw API command for making authenticated HTTP requests to any bunny.net endpoint

- [#31](https://github.com/BunnyWay/cli/pull/31) [`8343f16`](https://github.com/BunnyWay/cli/commit/8343f1683a9e3626b836979ebe693e76c58cb1ce) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Clean up .env credentials when deleting a database that matches the local environment

- [#30](https://github.com/BunnyWay/cli/pull/30) [`ac9cb05`](https://github.com/BunnyWay/cli/commit/ac9cb0501b423d38459180eea6163fc3ceb4df83) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Prompt to create an auth token and save to .env after interactive database creation

## 0.2.1

### Patch Changes

- [#20](https://github.com/BunnyWay/cli/pull/20) [`4eabd29`](https://github.com/BunnyWay/cli/commit/4eabd291e0259ea76ba81ae5a2fca082c89908f4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix database size formatting of bytes

- [#27](https://github.com/BunnyWay/cli/pull/27) [`eed0cc6`](https://github.com/BunnyWay/cli/commit/eed0cc6d1e1a16b84283d39ad7fff29f779cd1b7) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - use custom fetch client for database shell

- [#25](https://github.com/BunnyWay/cli/pull/25) [`c445698`](https://github.com/BunnyWay/cli/commit/c445698460125968bcccae79a9fe4d2d6159abb6) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - show notice when last region is removed that there are no other replicas

- [#22](https://github.com/BunnyWay/cli/pull/22) [`689830f`](https://github.com/BunnyWay/cli/commit/689830faf454e648b6be89d5196de90b3a1263e4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - ask for confirmation when removing a database region

- [#24](https://github.com/BunnyWay/cli/pull/24) [`0568cf2`](https://github.com/BunnyWay/cli/commit/0568cf226867ed6c844f8aa5359324f0f7787c4e) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - add prompt when creating a database token that previous ones remain valid

- [#23](https://github.com/BunnyWay/cli/pull/23) [`2add08f`](https://github.com/BunnyWay/cli/commit/2add08f3a0d7d69cf744dddfcbcfab1761fa15af) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - add get started and shell instructions on successfull database creation

- [#26](https://github.com/BunnyWay/cli/pull/26) [`340d501`](https://github.com/BunnyWay/cli/commit/340d5012d1b5671a7b187535e5bd805937180718) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - warn when no new tokens created after invalidation

## 0.2.0

### Minor Changes

- [#13](https://github.com/BunnyWay/cli/pull/13) [`a9b8fa9`](https://github.com/BunnyWay/cli/commit/a9b8fa904c621648aa4c416770633ed99e8645c5) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add saved views (queries) to the database shell and CLI

## 0.1.6

### Patch Changes

- [`2230dc1`](https://github.com/BunnyWay/cli/commit/2230dc1a5e4e9d8285e44ba0756cd3f11f3b5714) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix published binaries missing execute permissions and improve error messages for binary execution failures

## 0.1.5

### Patch Changes

- [`d375663`](https://github.com/BunnyWay/cli/commit/d375663b03ddab19a0459e53e97bb9dbb5b65726) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix npm-published binaries not being executable, causing silent failures when running via npx

## 0.1.4

### Patch Changes

- [`4f2f729`](https://github.com/BunnyWay/cli/commit/4f2f72906c07e865019d262614f1be6d0cd81856) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix compiled binary startup crash and optimize builds

  - Switch to @libsql/client/web to eliminate native addon dependency that crashed compiled binaries
  - Lazy-load database imports to prevent startup failures for non-db commands
  - Add --minify and --sourcemap flags for smaller, more debuggable production builds

## 0.1.3

### Patch Changes

- [`b9aaa20`](https://github.com/BunnyWay/cli/commit/b9aaa206c22ebacd628b2a7bb1bb14e77d3449bc) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Switch from @libsql/client to @libsql/client/web to eliminate native addon dependency, fix compiled binary by lazy-loading database imports and inlining version at build time

## 0.1.2

### Patch Changes

- [`b8bb433`](https://github.com/BunnyWay/cli/commit/b8bb433bb396d4c220983915a50555a477335c06) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix npm install by moving build-time dependencies to devDependencies (they are compiled into the binary)

## 0.1.1

### Patch Changes

- [#6](https://github.com/BunnyWay/cli/pull/6) [`b32272f`](https://github.com/BunnyWay/cli/commit/b32272fb8bcf621980832f8a11a59679e266e54a) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - add missing platform arch in version flag

## 0.1.0

### Minor Changes

- [`39641c1`](https://github.com/BunnyWay/cli/commit/39641c1ef18739cd8201fea766df272ef46b6fc7) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - initial bunny cli

### Patch Changes

- Updated dependencies [[`39641c1`](https://github.com/BunnyWay/cli/commit/39641c1ef18739cd8201fea766df272ef46b6fc7)]:
  - @bunny.net/database-shell@0.1.0
