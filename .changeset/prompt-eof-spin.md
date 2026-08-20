---
"@bunny.net/cli": patch
---

fix(core): prompts no longer spin at 100% CPU forever when stdin closes before an answer (CI, cron, `< /dev/null`); every prompt now aborts fast at EOF, input prompts and destructive confirmations exit non-zero with a hint naming the flag to pass (`--force` or the value flag), offer-style prompts decline and continue, and piped answers keep working
