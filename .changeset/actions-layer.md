---
"@bunny.net/cli": minor
---

feat(actions): add `@bunny.net/actions`, a headless action layer (`{ name, description, schema, destructive, run(ctx, input) }`) that the CLI now wraps via `defineActionCommand` (prepare -> confirm -> spinner -> after -> render), with `@bunny.net/actions/mcp` converting the same definitions into MCP tool descriptors. `storage zones list/show/remove`, `storage regions`, `db list`, and `db show` run on actions; `storage zones add` calls the create action directly. `--output json` for those commands now returns the normalized action result (camelCase, credential-free, region names resolved) instead of the raw API model, and `storage zones list` gains `--search`.
