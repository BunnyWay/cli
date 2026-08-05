---
"@bunny.net/cli": patch
---

fix(sites): create the `*.preview.{domain}` DNS record before attaching the wildcard (its validation needs live DNS), run preview setup after the apex flow, and verify certificates actually serve before reporting HTTPS success
