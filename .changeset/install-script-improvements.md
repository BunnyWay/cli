---
"@bunny.net/cli": patch
---

Improve the `install.sh` shell installer:

- Default install directory is now `~/.bunny/bin` (no sudo required). Set `BUNNY_INSTALL_DIR=/usr/local/bin` to keep the previous behaviour.
- On macOS, the installer now clears the `com.apple.quarantine` xattr and ad-hoc codesigns the binary so Gatekeeper allows execution on first run (fixes "killed: 9" on Apple Silicon).
- Resolving the latest version no longer calls `api.github.com` (rate-limited to 60 req/hr); it uses GitHub's `releases/latest/download` redirect instead.
- The script now warns if a legacy `bunny` binary is still present at `/usr/local/bin/bunny`, since depending on PATH order it may shadow the new install. Remove it with `sudo rm /usr/local/bin/bunny`.
