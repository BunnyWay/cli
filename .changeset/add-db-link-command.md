---
"@bunny.net/cli": minor
---

Add `bunny db link` and lifecycle integration for `.bunny/database.json`

- New `bunny db link [database-id]` command that writes `{ id, name }` to `.bunny/database.json`. Subsequent `db` commands resolve the target without needing `BUNNY_DATABASE_URL` in `.env`.
- Database ID resolution order is now: explicit argument → `.bunny/database.json` → `BUNNY_DATABASE_URL` in `.env` → interactive prompt. The resolver also returns the database name when known, so commands like `db tokens create` can show `Database: <name> (<id>) (from ...)` without an extra API call.
- `bunny db create` now offers to link the new database to the current directory, generate an auth token, and save credentials to `.env`. Three new flags make these phases non-interactive: `--link`/`--no-link`, `--token`/`--no-token`, `--save-env`/`--no-save-env`. In `--output json` mode, prompts are suppressed entirely — flags are the only way to opt in. The JSON output gains `linked`, `token`, and `saved_to_env` fields.
- `bunny db delete` now removes `.bunny/database.json` automatically when it points at the deleted database, so subsequent commands don't try to resolve a dead ID.
