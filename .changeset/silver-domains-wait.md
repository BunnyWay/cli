---
"@bunny.net/cli": minor
---

feat(scripts): wait for DNS and enable HTTPS automatically when adding a custom domain

`scripts domains add` gains `--wait` to poll DNS (up to 10 minutes) and issue the free SSL certificate once the domain points at bunny.net; interactive runs offer the same. `scripts create` and `scripts init` now offer a custom domain as part of the flow.
