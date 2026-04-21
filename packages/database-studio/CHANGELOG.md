# @bunny.net/database-studio

## 0.1.1

### Patch Changes

- [#49](https://github.com/BunnyWay/cli/pull/49) [`61e1518`](https://github.com/BunnyWay/cli/commit/61e1518df6e24dcfc62ac5ef4c299b53a9275ebf) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Harden `bunny db studio` against LAN, cross-origin, and credential-persistence attacks

  - The studio HTTP server now binds to `127.0.0.1` instead of every interface, so LAN peers, container bridges, and VPC siblings can no longer reach it.
  - `Access-Control-Allow-Origin: *` and the `OPTIONS` preflight branch were removed. The SPA is same-origin (Vite proxies `/api` in dev; prod serves the SPA and API from the same port), so no cross-origin grant is needed. Evil pages loaded in another tab can no longer read the API.
  - Added a Host header allowlist (`localhost`, `127.0.0.1`, `[::1]`). Requests with any other Host are rejected with `403`, which blocks DNS-rebinding even if the server is reachable via a non-loopback address.
  - The API is now gated behind a per-startup session token. The auto-opened URL carries `?token=…` once; the client exchanges it for an HttpOnly, SameSite=Strict cookie via `POST /api/auth` and scrubs the token from the URL. Every other `/api/*` request requires the cookie (timing-safe compare) or returns `401`.
  - `db studio` now prints a warning and prompts for confirmation before starting, explaining that a full-access libsql token will be minted and loaded into a browser tab. A `--force`/`-f` flag skips the prompt for CI and agents.
  - The libsql token minted on each run now expires after 30 minutes instead of never. This bounds the blast radius if the token ever leaves the developer's machine.

- [#44](https://github.com/BunnyWay/cli/pull/44) [`87d76e1`](https://github.com/BunnyWay/cli/commit/87d76e131a85a1419f0ebc05abb400e396c1fc5a) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Fix table list overflow on the studio landing page

  The initial table list was wrapped in a `h-full` flex container with `items-center justify-center`, sitting inside a `<main>` with `overflow-hidden`. When more tables were present than fit on screen, the centered list overflowed `<main>` and was clipped with no way to scroll. Wrapped the card in `overflow-y-auto` and switched the centering layer to `min-h-full` so it stays vertically centered when content fits and scrolls when it doesn't.

## 0.1.0

### Minor Changes

- [#43](https://github.com/BunnyWay/cli/pull/43) [`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Refactor studio to use `@bunny.net/database-rest` and `@bunny.net/database-adapter-libsql`

  Replaces the hand-rolled API handler with the shared REST package. The studio
  now introspects the database at startup and delegates all API routes to
  `createRestHandler`. The frontend reads table and schema info from the OpenAPI
  spec served at the root endpoint.

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

- Updated dependencies [[`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642), [`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642)]:
  - @bunny.net/database-adapter-libsql@0.1.0
  - @bunny.net/database-rest@0.1.0

## 0.0.5

### Patch Changes

- [`72759e7`](https://github.com/BunnyWay/cli/commit/72759e772dc5ca2810e59eb6ba8d5703633de398) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - embed studio assets in compiled CLI binary

  The database studio UI was returning "Not Found" when launched from
  the compiled binary because the static files weren't embedded in
  the executable. Studio assets are now bundled via Bun's file
  embedding at compile time.

## 0.0.4

### Patch Changes

- [`b0ba799`](https://github.com/BunnyWay/cli/commit/b0ba799143c161f464c2dfc27bbe1c31f625f849) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix build step

## 0.0.3

### Patch Changes

- [`b46d346`](https://github.com/BunnyWay/cli/commit/b46d34630184561f29ea514d9a8b3cd6ef1b2114) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - fix static output

## 0.0.2

### Patch Changes

- [#16](https://github.com/BunnyWay/cli/pull/16) [`989ddd9`](https://github.com/BunnyWay/cli/commit/989ddd93b36cf158662cdb5a4f28c03032b994b4) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - - Fix `Input` component not passing props (`value`, `onChange`, `min`, `max`, etc.) to the underlying `<input>` element — missing `{...props}` spread
  - Add server-side sorting via `sort` and `order` query params on the `/rows` API endpoint (replaces client-side sorting)
  - Add copy-to-clipboard button on table cells (appears on row hover, shows checkmark confirmation)
  - Add column visibility toggle with dropdown menu in the toolbar
  - Add OR filter logic — filters can now be combined with AND or OR via a `ButtonGroup` toggle
  - Add FK badge on foreign key column headers (matches existing PK badge style)
  - Add refresh button to re-fetch the current table data
  - Replace raw `<select>` elements in filter bar with shadcn `Select` component
  - Replace raw `<input>` element in filter bar with shadcn `Input` component
  - Replace native checkbox in columns dropdown with shadcn `Checkbox` component
  - Add shadcn `ButtonGroup`, `Select`, and `Checkbox` UI components
  - Add `--dev` flag (hidden) to `db studio` command to spawn Vite dev server with HMR
  - Add loading state and table list to empty studio on launch
