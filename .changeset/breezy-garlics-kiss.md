---
"@bunny.net/database-studio": patch
---

- Fix `Input` component not passing props (`value`, `onChange`, `min`, `max`, etc.) to the underlying `<input>` element — missing `{...props}` spread
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
