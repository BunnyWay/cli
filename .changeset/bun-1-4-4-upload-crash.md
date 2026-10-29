---
"@bunny.net/cli": patch
---

fix: the binaries are now built with Bun 1.4.4. Binaries built with Bun 1.3.x could crash with a floating point exception after uploading a small file in `sites deploy` and `storage files upload`.
