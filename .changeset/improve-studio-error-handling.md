---
"@bunny.net/database-studio": patch
"@bunny.net/cli": patch
---

improve `db studio` error handling

A single broken table used to cause cascading UI problems:

- `/api/tables` would 500 if any one table's row count failed, locking
  users out of the sidebar entirely. The endpoint now isolates per-table
  errors and returns a `null` row count for just the broken table.
- The client's `fetch` wrapper now surfaces the server's `error` body in
  the thrown message instead of a bare `API error: 500`.
- `TableView` now shows an error screen with a Retry button when a table
  fails to load, instead of silently rendering an empty half-initialized
  view. Refresh failures keep stale data visible with an inline banner.
