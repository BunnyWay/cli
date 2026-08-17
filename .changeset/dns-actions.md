---
"@bunny.net/cli": minor
---

feat(dns): extract DNS zones and records into `@bunny.net/actions` (dns.zones list/get/create/delete, dns.records list/create/update/delete/scan/import) and wire `dns zones list/show/remove` and `dns records list/update/remove` through the action layer; `--output json` for those commands now returns the normalized shape instead of the raw API model
