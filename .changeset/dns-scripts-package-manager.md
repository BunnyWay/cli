---
"@bunny.net/cli": patch
---

fix(dns): `dns scripts init` detects and uses any installed package manager (bun, pnpm, yarn, npm) instead of assuming bun, and warns clearly when none is on PATH
