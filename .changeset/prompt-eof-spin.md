---
"@bunny.net/cli": patch
---

fix(core): prompts no longer spin at 100% CPU forever when run without a terminal (CI, cron, `< /dev/null`); prompts now require an interactive terminal, so input prompts and destructive confirmations fail fast with exit 1 and a hint naming the flag to pass (`--force` or the value flag), offer-style prompts decline and continue, and piped prompt answers are no longer supported (pass flags instead)
