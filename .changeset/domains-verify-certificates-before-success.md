---
"@bunny.net/cli": patch
---

fix(domains): verify a certificate actually landed on the exact hostname before forcing HTTPS or reporting success, and TLS-probe the domain afterwards so a mismatched certificate (e.g. shadowed by another zone's wildcard) warns instead of printing a broken "Live at" URL
