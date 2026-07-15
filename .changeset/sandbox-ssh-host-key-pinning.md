---
"@bunny.net/sandbox": patch
"@bunny.net/cli": patch
---

fix(sandbox): verify a sandbox's SSH host key before sending a token, pinning it in a known-hosts store to prevent credential disclosure to an impersonating server
