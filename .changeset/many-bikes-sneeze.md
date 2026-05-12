---
"@bunny.net/database-studio": patch
"@bunny.net/cli": patch
---

Harden credential handling across the CLI and database studio: scrub auth tokens from URLs on failure, ignore invalid OAuth callback state, keep `--force` scoped to the remote delete (the `.env` cleanup still confirms), mask the API key in JSON output, expire `db shell` sessions after 30 minutes, and hide the Edge Script deployment key from default output.

Thanks to @jedisct1.
