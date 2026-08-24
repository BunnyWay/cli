---
"@bunny.net/cli": patch
---

fix(storage): correct file listing, path joining, root deletes. `storage files remove` now fails fast instead of prompting when nobody can answer. Also match the dashboard's region sets per tier and S3 support
