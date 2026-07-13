---
"@bunny.net/cli": minor
---

feat(sandbox): add `bunny sandbox files list` (alias: `ls`) to list files in a sandbox directory over SFTP (bare name lists `/workplace`, or `<sandbox>:<path>`), and `--timeout` on `bunny sandbox exec` to close the SSH connection and exit 124 after N seconds.
