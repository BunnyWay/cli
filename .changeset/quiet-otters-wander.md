---
"@bunny.net/cli": patch
---

fix(scripts/init): detect the user's package manager (bun, pnpm, yarn, npm) via npm_config_user_agent, template lockfile, and PATH probe instead of always running `bun install`; warn cleanly when none is available, and surface a notice when the chosen PM doesn't match the template's lockfile
