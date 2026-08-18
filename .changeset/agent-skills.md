---
"@bunny.net/cli": minor
---

feat(skills): `bunny skills install` installs the bunny agent skill so AI coding tools know how to use the CLI; a project install upserts a marked block into AGENTS.md and, when the project uses Claude Code, writes the full skill with references to `.claude/skills/bunny-cli/`, while `--global` writes it to `~/.claude/skills/bunny-cli/` for every project; the installed content is the shipped `skills/bunny-cli/` skill embedded at build time
