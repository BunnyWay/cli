---
"@bunny.net/cli": patch
"@bunny.net/database-shell": patch
---

fix: resolve open code scanning alerts; markdown table cells escape backslashes before pipes so a value containing `\|` no longer splits the cell, the SQL statement splitter counts block depth with a linear scan instead of a regex that rescanned from every offset on a run of unclosed `[`, `sites ci` detects a GitHub origin by remote host instead of a substring match, `database-rest` returns a generic 500 and hands the real error to an `onError` hook (wired to the studio's logger) instead of putting it in the response body, and the CI, template-upload, and install-script-upload workflows pin `GITHUB_TOKEN` to `contents: read`
