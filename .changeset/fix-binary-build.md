---
"@bunny.net/cli": patch
"@bunny.net/database-shell": patch
---

Fix compiled binary startup crash and optimize builds

- Switch to @libsql/client/web to eliminate native addon dependency that crashed compiled binaries
- Lazy-load database imports to prevent startup failures for non-db commands
- Add --minify and --sourcemap flags for smaller, more debuggable production builds
