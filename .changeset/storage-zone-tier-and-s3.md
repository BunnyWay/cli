---
"@bunny.net/cli": patch
---

storage zones surface tier and S3 support: Tier/S3 columns on `list`, both reported by `show`, and `add` prompts for them (`--tier hdd|ssd`, `--s3`) then offers to link the directory, show HTTP API, FTP, or S3 connection details, and save them to `.env`; `zones credentials` gains the same `--connection http|ftp|s3` picker with a docs link per protocol, `--format sdk` for a ready-to-paste `@bunny.net/storage-sdk` snippet alongside the rclone, aws, s3cmd, and env configs, and its own `.env` follow-up
