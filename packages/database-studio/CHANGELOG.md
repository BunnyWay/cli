# @bunny.net/database-studio

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
